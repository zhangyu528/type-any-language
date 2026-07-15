"""Phase 2 end-to-end verification.

Spins up against a Postgres 15 container (tal-test-pg, already running on
localhost:55432 from this session) and exercises:

  Test 1: fresh DB -- migrations apply, schema has all new columns/tables.
  Test 2: pre-Phase-2 DB -- baseline migration is a no-op (create_all was
          already run by init_schema), 0002-0005 still apply cleanly.
  Test 3: import_vocab -- old 4-col CSV works AND new 9-col CSV lands the
          metadata columns correctly.
  Test 4: sentence_word_links -- insert_sentences populates links via FK join.
  Test 5: lesson_index -- migration 0007 adds the column + backfills by
          positional rank, and import_vocab's assign_lesson_indexes re-buckets
          on subsequent syncs.

Run with DATABASE_URL set:

    DATABASE_URL=postgresql://english_user:testpw@localhost:55432/english_learning \
        PYTHONPATH=cms/tools:db/tools python cms/cms_pipeline/tests/test_phase2_e2e.py
"""
import os
import sys
import tempfile
import uuid
from pathlib import Path

import psycopg2

# --- Make cms + backend importable ---
ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))                # cms/tools/ — data pipeline
sys.path.insert(0, str(ROOT / "db" / "tools"))  # db/tools/ — schema + migrations

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://english_user:testpw@localhost:55432/english_learning",
)


def fresh_db() -> psycopg2.extensions.connection:
    """Drop + recreate english_learning on the test container."""
    admin_url = DATABASE_URL.replace("/english_learning", "/postgres")
    admin = psycopg2.connect(admin_url)
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute("DROP DATABASE IF EXISTS english_learning")
        cur.execute("CREATE DATABASE english_learning")
    admin.close()
    return psycopg2.connect(DATABASE_URL)


def column_names(conn, table: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = %s ORDER BY ordinal_position
            """,
            (table,),
        )
        return [r[0] for r in cur.fetchall()]


def tables_in_public(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
            """
        )
        return {r[0] for r in cur.fetchall()}


def test_1_fresh_db():
    print("\n=== Test 1: fresh DB, all migrations apply ===")
    conn = fresh_db()
    try:
        from dbtools.migrations import upgrade_head, get_current_version

        v0 = get_current_version(conn)
        assert v0 is None, f"expected None, got {v0!r}"
        applied = upgrade_head(conn)
        print(f"  applied: {applied}")
        assert len(applied) == 7, f"expected 7 migrations, got {len(applied)}"
        expected = [
            "0001_baseline",
            "0002_vocab_metadata",
            "0003_sentence_metadata",
            "0004_sentence_word_links",
            "0005_drop_dead_columns",
            "0006_sentence_natural_key",
            "0007_lesson_index",
        ]
        assert applied == expected, f"order mismatch: {applied}"

        # schema_migrations has 5 rows
        with conn.cursor() as cur:
            cur.execute("SELECT version FROM schema_migrations ORDER BY version")
            assert [r[0] for r in cur.fetchall()] == expected

        # All expected tables exist
        ts = tables_in_public(conn)
        print(f"  tables: {sorted(ts)}")
        for t in ("vocabulary_libs", "vocabulary_words", "sentences",
                  "sentence_word_links", "schema_migrations"):
            assert t in ts, f"missing table: {t}"

        # vocabulary_words metadata columns
        vw = column_names(conn, "vocabulary_words")
        print(f"  vocab_words cols: {vw}")
        for c in ("frequency", "register", "domain", "example", "tags", "lesson_index"):
            assert c in vw, f"missing vocab column: {c}"

        # sentences metadata columns
        s = column_names(conn, "sentences")
        print(f"  sentences cols: {s}")
        for c in ("topic", "register", "cefr", "tags"):
            assert c in s, f"missing sentence column: {c}"
        # Dead columns gone
        for c in ("is_cached", "is_stale", "refresh_count"):
            assert c not in s, f"dead column still present: {c}"

        # sentence_word_links structure
        swl = column_names(conn, "sentence_word_links")
        print(f"  sentence_word_links cols: {swl}")
        assert swl == ["sentence_id", "word_id"], f"unexpected: {swl}"

        # Idempotency: re-run upgrade_head -- should be no-op
        again = upgrade_head(conn)
        assert again == [], f"expected no-op, got {again}"
        print("  idempotent re-run: OK")
    finally:
        conn.close()
    print("Test 1: PASS")


def test_2_pre_phase2_baseline():
    print("\n=== Test 2: pre-Phase-2 DB, baseline is no-op + 0002-0005 apply ===")
    conn = fresh_db()
    try:
        # Simulate pre-Phase-2 schema via raw DDL. SQLAlchemy won't let us
        # "un-map" individual columns, so we build the legacy schema by hand.
        legacy_ddl = """
        CREATE TABLE vocabulary_libs (
            id          UUID PRIMARY KEY,
            name        VARCHAR(100) NOT NULL,
            level       VARCHAR(20)  NOT NULL,
            word_count  INTEGER      DEFAULT 0,
            created_at  TIMESTAMP    DEFAULT now()
        );
        CREATE TABLE vocabulary_words (
            id             UUID PRIMARY KEY,
            lib_id         UUID NOT NULL REFERENCES vocabulary_libs(id),
            word           VARCHAR(100) NOT NULL,
            phonetic       VARCHAR(100) DEFAULT '',
            translation    TEXT         DEFAULT '',
            part_of_speech VARCHAR(20)  DEFAULT '',
            created_at     TIMESTAMP    DEFAULT now()
        );
        CREATE TABLE sentences (
            id              UUID PRIMARY KEY,
            lib_id          UUID NOT NULL REFERENCES vocabulary_libs(id),
            text            TEXT NOT NULL,
            chinese_text    TEXT DEFAULT '',
            target_words    VARCHAR[] DEFAULT ARRAY[]::VARCHAR[],
            difficulty      VARCHAR(20) DEFAULT 'beginner',
            audio_url       VARCHAR(500) DEFAULT '',
            is_cached       BOOLEAN DEFAULT TRUE,
            is_stale        BOOLEAN DEFAULT FALSE,
            refresh_count   INTEGER DEFAULT 0,
            use_count       INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT now(),
            last_used_at    TIMESTAMP DEFAULT now()
        );
        """
        with conn.cursor() as cur:
            cur.execute(legacy_ddl)
        conn.commit()

        # Verify the OLD schema: no new columns, no sentence_word_links,
        # but is_cached/is_stale/refresh_count ARE present.
        vw = column_names(conn, "vocabulary_words")
        s = column_names(conn, "sentences")
        ts = tables_in_public(conn)
        print(f"  pre-phase2 vocab_words cols: {vw}")
        print(f"  pre-phase2 sentences cols: {s}")
        print(f"  pre-phase2 tables: {sorted(ts)}")
        new_vocab_cols = ("frequency", "register", "domain", "example", "tags")
        new_sent_cols = ("topic", "register", "cefr", "tags")
        for c in new_vocab_cols:
            assert c not in vw, f"old schema shouldn't have {c}"
        for c in new_sent_cols:
            assert c not in s, f"old schema shouldn't have {c}"
        assert "sentence_word_links" not in ts
        for c in ("is_cached", "is_stale", "refresh_count"):
            assert c in s, f"old schema SHOULD have {c}"

        # Insert a sample row so we can verify it survives the migration.
        lib_id = "00000000-0000-0000-0000-000000000001"
        boat_id = "00000000-0000-0000-0000-000000000002"
        sent_id = "00000000-0000-0000-0000-000000000003"
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO vocabulary_libs (id, name, level) VALUES (%s, %s, %s)",
                (lib_id, "Legacy Lib", "legacy"),
            )
            cur.execute(
                "INSERT INTO vocabulary_words (id, lib_id, word, phonetic) "
                "VALUES (%s, %s, %s, %s)",
                (boat_id, lib_id, "boat", "/boʊt/"),
            )
            cur.execute(
                "INSERT INTO sentences (id, lib_id, text, target_words, is_cached) "
                "VALUES (%s, %s, %s, %s, %s)",
                (sent_id, lib_id, "Legacy sentence.", ["boat"], True),
            )
        conn.commit()

        # Run the migration runner. 0001 uses SQLAlchemy create_all --
        # idempotent against existing 3 tables. 0002-0005 add new columns
        # + sentence_word_links + drop dead columns.
        from dbtools.migrations import upgrade_head, get_current_version

        v0 = get_current_version(conn)
        print(f"  pre-migration version: {v0!r}")
        applied = upgrade_head(conn)
        print(f"  applied: {applied}")
        assert len(applied) == 7, f"expected 7 versions stamped, got {len(applied)}"

        # Verify the post-migration schema matches the fresh-DB target.
        vw2 = column_names(conn, "vocabulary_words")
        s2 = column_names(conn, "sentences")
        ts2 = tables_in_public(conn)
        for c in new_vocab_cols:
            assert c in vw2, f"missing after migration: {c}"
        for c in new_sent_cols:
            assert c in s2, f"missing after migration: {c}"
        for c in ("is_cached", "is_stale", "refresh_count"):
            assert c not in s2, f"dead column survived: {c}"
        assert "sentence_word_links" in ts2
        print("  post-migration schema matches fresh-DB target")

        # Verify legacy rows survived.
        with conn.cursor() as cur:
            cur.execute("SELECT word, phonetic FROM vocabulary_words WHERE id = %s", (boat_id,))
            row = cur.fetchone()
            print(f"  legacy vocab row: {row}")
            assert row[0] == "boat" and row[1] == "/boʊt/"
            cur.execute("SELECT text, target_words FROM sentences WHERE id = %s", (sent_id,))
            row = cur.fetchone()
            print(f"  legacy sentence row: {row}")
            assert row[0] == "Legacy sentence." and row[1] == ["boat"]
    finally:
        conn.close()
    print("Test 2: PASS")


def test_3_import_vocab():
    print("\n=== Test 3: import_vocab handles old 4-col + new 9-col CSV ===")
    conn = fresh_db()
    try:
        from dbtools.migrations import upgrade_head
        upgrade_head(conn)
        conn.commit()

        # Create two vocabulary_libs rows so the FK works.
        old_lib = str(uuid.uuid4())
        new_lib = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO vocabulary_libs (id, name, level) VALUES (%s, %s, %s)",
                (old_lib, "Old CSV Lib", "old"),
            )
            cur.execute(
                "INSERT INTO vocabulary_libs (id, name, level) VALUES (%s, %s, %s)",
                (new_lib, "New CSV Lib", "new"),
            )
        conn.commit()

        from cms_pipeline.import_vocab import import_words

        # Old 4-col CSV
        old_csv = Path(tempfile.mkdtemp()) / "old.csv"
        old_csv.write_text(
            "word,phonetic,translation,part_of_speech\n"
            "boat,,小船,n\n"
            "group,,团体,n\n",
            encoding="utf-8",
        )
        n_old = import_words(conn, old_lib, old_csv)
        print(f"  old CSV: {n_old} rows inserted")
        assert n_old == 2

        # New 9-col CSV
        new_csv = Path(tempfile.mkdtemp()) / "new.csv"
        new_csv.write_text(
            "word,phonetic,translation,part_of_speech,frequency,register,domain,example,tags\n"
            "negotiate,,谈判,v,1200,formal,business,\"Let us negotiate the price.\",\"business;verb\"\n"
            "gonna,,将要,aux,5000,informal,casual,,\"contraction;spoken\"\n",
            encoding="utf-8",
        )
        n_new = import_words(conn, new_lib, new_csv)
        print(f"  new CSV: {n_new} rows inserted")
        assert n_new == 2

        conn.commit()

        with conn.cursor() as cur:
            # Old rows: metadata is NULL
            cur.execute(
                "SELECT word, frequency, register, domain, example, tags "
                "FROM vocabulary_words WHERE lib_id = %s ORDER BY word",
                (old_lib,),
            )
            old_rows = cur.fetchall()
            print(f"  old rows: {old_rows}")
            for w, freq, reg, dom, ex, tags in old_rows:
                assert freq is None and reg is None and dom is None and ex is None and tags is None

            # New rows: metadata parsed
            cur.execute(
                "SELECT word, frequency, register, domain, example, tags "
                "FROM vocabulary_words WHERE lib_id = %s ORDER BY word",
                (new_lib,),
            )
            new_rows = cur.fetchall()
            print(f"  new rows: {new_rows}")
            by_word = {r[0]: r for r in new_rows}
            assert by_word["negotiate"][1] == 1200
            assert by_word["negotiate"][2] == "formal"
            assert by_word["negotiate"][3] == "business"
            assert by_word["negotiate"][4] == "Let us negotiate the price."
            assert sorted(by_word["negotiate"][5]) == ["business", "verb"]
            assert by_word["gonna"][1] == 5000
            assert by_word["gonna"][2] == "informal"
            assert by_word["gonna"][3] == "casual"
            assert by_word["gonna"][4] is None
            assert sorted(by_word["gonna"][5]) == ["contraction", "spoken"]
    finally:
        conn.close()
    print("Test 3: PASS")


def test_4_sentence_word_links():
    print("\n=== Test 4: insert_sentences populates sentence_word_links ===")
    conn = fresh_db()
    try:
        from dbtools.migrations import upgrade_head
        upgrade_head(conn)
        conn.commit()

        # Set up: 1 lib + 3 vocab words
        lib_id = str(uuid.uuid4())
        boat_id = str(uuid.uuid4())
        group_id = str(uuid.uuid4())
        apple_id = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO vocabulary_libs (id, name, level, word_count, created_at) "
                "VALUES (%s, %s, %s, %s, now())",
                (lib_id, "Test Lib", "test", 3),
            )
            for wid, w in [(boat_id, "boat"), (group_id, "group"), (apple_id, "apple")]:
                cur.execute(
                    "INSERT INTO vocabulary_words (id, lib_id, word, phonetic, translation, part_of_speech, created_at) "
                    "VALUES (%s, %s, %s, '', '', '', now())",
                    (wid, lib_id, w),
                )
        conn.commit()

        from cms_pipeline.generate_sentences import insert_sentences

        items = [
            {
                "text": "Boat sails across the lake.",
                "chinese_text": "小船划过湖面。",
                "target_words": ["Boat"],
                "topic": "travel",
                "register": "neutral",
                "cefr": "A2",
                "tags": ["water", "nature"],
            },
            {
                "text": "Group of friends gathered.",
                "chinese_text": "一群朋友聚在一起。",
                "target_words": ["Group", "banana"],  # banana not in vocab
                "topic": "daily_life",
                "register": "informal",
                "cefr": "B1",
                "tags": ["social"],
            },
        ]
        n = insert_sentences(conn, lib_id, "beginner", items)
        print(f"  insert_sentences returned: {n}")
        assert n == 2
        conn.commit()

        with conn.cursor() as cur:
            # Verify new metadata columns are populated
            cur.execute(
                "SELECT text, topic, register, cefr, tags FROM sentences "
                "WHERE lib_id = %s ORDER BY text",
                (lib_id,),
            )
            sent_rows = cur.fetchall()
            print(f"  sentences: {sent_rows}")
            by_text = {r[0]: r for r in sent_rows}
            assert by_text["Boat sails across the lake."][1] == "travel"
            assert by_text["Boat sails across the lake."][2] == "neutral"
            assert by_text["Boat sails across the lake."][3] == "A2"
            assert sorted(by_text["Boat sails across the lake."][4]) == ["nature", "water"]

            # Verify sentence_word_links
            cur.execute(
                """
                SELECT s.text, vw.word FROM sentence_word_links swl
                JOIN sentences s ON s.id = swl.sentence_id
                JOIN vocabulary_words vw ON vw.id = swl.word_id
                WHERE s.lib_id = %s
                ORDER BY s.text, vw.word
                """,
                (lib_id,),
            )
            links = cur.fetchall()
            print(f"  links: {links}")
            assert ("Boat sails across the lake.", "boat") in links
            assert ("Group of friends gathered.", "group") in links
            # banana wasn't a vocab word so no link
            assert not any("banana" in str(l) for l in links)

            # Verify is_cached column is gone
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'sentences' AND column_name IN ('is_cached', 'is_stale', 'refresh_count')"
            )
            dead = [r[0] for r in cur.fetchall()]
            assert dead == [], f"dead columns still present: {dead}"

        # Idempotency: re-insert same items, should be ON CONFLICT-skipped,
        # links table should not double up.
        n2 = insert_sentences(conn, lib_id, "beginner", items)
        print(f"  re-insert returned: {n2}")
        assert n2 == 0
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM sentence_word_links swl "
                "JOIN sentences s ON s.id = swl.sentence_id WHERE s.lib_id = %s",
                (lib_id,),
            )
            link_count = cur.fetchone()[0]
            print(f"  link count after re-insert: {link_count}")
            assert link_count == 2, f"expected 2 links, got {link_count}"
    finally:
        conn.close()
    print("Test 4: PASS")


def test_5_lesson_index():
    """Migration 0007 adds lesson_index + backfills by positional rank,
    and import_vocab's assign_lesson_indexes re-buckets on re-sync.

    The migration's backfill is a one-shot at migration time. Production
    flow is:
      - Fresh DB: migration runs on empty tables (no-op backfill), then
        `staging.sh sync` imports CSVs → import_words → assign_lesson_indexes.
      - Existing DB: migration adds the column and backfills existing rows;
        subsequent re-syncs re-bucket via assign_lesson_indexes.

    This test exercises both paths."""
    print("\n=== Test 5: lesson_index backfill + import_vocab re-bucketing ===")
    conn = fresh_db()
    try:
        from dbtools.migrations import upgrade_head
        upgrade_head(conn)
        conn.commit()

        from cms_pipeline.import_vocab import assign_lesson_indexes

        # ---- Path 1: pre-populated DB, migration backfills ----
        # Drop+recreate to simulate an existing DB with words already
        # present when the migration runs.
        conn.close()
        conn = fresh_db()
        # Only apply baseline (no metadata columns yet). Insert 7 words.
        from dbtools.migrations.runner import (
            ensure_schema_migrations_table,
            get_current_version,
        )
        from app.database import Base  # noqa: F401  (registers models)
        from app.models import vocabulary, sentence  # noqa: F401

        # Apply baseline only (it just calls SQLAlchemy create_all).
        ensure_schema_migrations_table(conn)
        # Manually create the 3 tables via SQLAlchemy against this conn.
        from sqlalchemy import create_engine
        cfg_db_url = os.environ["DATABASE_URL"]
        eng = create_engine(cfg_db_url)
        Base.metadata.create_all(eng)
        eng.dispose()

        # Stamp 0001 so the next migration run doesn't re-apply it.
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO schema_migrations (version) VALUES ('0001_baseline')"
            )
        conn.commit()

        lib_id = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO vocabulary_libs (id, name, level, word_count, created_at) "
                "VALUES (%s, %s, %s, %s, now())",
                (lib_id, "Pre-existing Lib", "pre", 7),
            )
            for i in range(1, 8):
                cur.execute(
                    "INSERT INTO vocabulary_words (id, lib_id, word, phonetic, "
                    "translation, part_of_speech, created_at) "
                    "VALUES (%s, %s, %s, '', '', '', now())",
                    (str(uuid.uuid4()), lib_id, f"pre{i}"),
                )
        conn.commit()

        # Now run the rest of the migrations including 0007.
        # upgrade_head will skip 0001 (already stamped) and apply 0002-0007.
        applied = upgrade_head(conn)
        print(f"  migration applied on pre-populated DB: {applied}")
        assert "0007_lesson_index" in applied, f"0007 not in {applied}"

        with conn.cursor() as cur:
            cur.execute(
                "SELECT word, lesson_index FROM vocabulary_words "
                "WHERE lib_id = %s ORDER BY created_at, id",
                (lib_id,),
            )
            rows = cur.fetchall()
        print(f"  post-migration backfill rows: {rows}")
        assert [r[1] for r in rows] == [1, 1, 1, 1, 1, 2, 2], (
            f"migration backfill wrong: {[r[1] for r in rows]}"
        )

        # ---- Path 2: post-migration insert + assign_lesson_indexes ----
        # Insert another 7 words (a new lib) — migration already ran, so
        # the new rows start with lesson_index = NULL. Then exercise
        # assign_lesson_indexes, which is the production code path for
        # new content.
        lib_id_2 = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO vocabulary_libs (id, name, level, word_count, created_at) "
                "VALUES (%s, %s, %s, %s, now())",
                (lib_id_2, "Post-migration Lib", "post", 7),
            )
            for i in range(1, 8):
                cur.execute(
                    "INSERT INTO vocabulary_words (id, lib_id, word, phonetic, "
                    "translation, part_of_speech, created_at) "
                    "VALUES (%s, %s, %s, '', '', '', now())",
                    (str(uuid.uuid4()), lib_id_2, f"post{i}"),
                )
        conn.commit()

        # New rows: lesson_index is NULL.
        with conn.cursor() as cur:
            cur.execute(
                "SELECT lesson_index FROM vocabulary_words "
                "WHERE lib_id = %s ORDER BY created_at, id",
                (lib_id_2,),
            )
            pre = [r[0] for r in cur.fetchall()]
        print(f"  new rows before assign: {pre}")
        assert pre == [None] * 7

        # Run assign_lesson_indexes with default size 5.
        updated = assign_lesson_indexes(conn, lib_id_2, lesson_size=5)
        print(f"  assign_lesson_indexes(5) updated {updated} rows")
        assert updated == 7

        with conn.cursor() as cur:
            cur.execute(
                "SELECT lesson_index FROM vocabulary_words "
                "WHERE lib_id = %s ORDER BY created_at, id",
                (lib_id_2,),
            )
            lesson_indexes = [r[0] for r in cur.fetchall()]
        assert lesson_indexes == [1, 1, 1, 1, 1, 2, 2], (
            f"assign_lesson_indexes wrong: {lesson_indexes}"
        )

        # Re-bucket with lesson_size=3.
        assign_lesson_indexes(conn, lib_id_2, lesson_size=3)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT lesson_index FROM vocabulary_words "
                "WHERE lib_id = %s ORDER BY created_at, id",
                (lib_id_2,),
            )
            assert [r[0] for r in cur.fetchall()] == [1, 1, 1, 2, 2, 2, 3]

        # Idempotency: same size, same result.
        assign_lesson_indexes(conn, lib_id_2, lesson_size=3)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT lesson_index FROM vocabulary_words "
                "WHERE lib_id = %s ORDER BY created_at, id",
                (lib_id_2,),
            )
            assert [r[0] for r in cur.fetchall()] == [1, 1, 1, 2, 2, 2, 3]

        # Edge case: lesson_size=1 → every word is its own lesson.
        assign_lesson_indexes(conn, lib_id_2, lesson_size=1)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT lesson_index FROM vocabulary_words "
                "WHERE lib_id = %s ORDER BY created_at, id",
                (lib_id_2,),
            )
            assert [r[0] for r in cur.fetchall()] == [1, 2, 3, 4, 5, 6, 7]

        # Bad input: lesson_size=0 raises.
        try:
            assign_lesson_indexes(conn, lib_id_2, lesson_size=0)
        except ValueError as e:
            print(f"  lesson_size=0 rejected: {e}")
        else:
            raise AssertionError("expected ValueError for lesson_size=0")
    finally:
        conn.close()
    print("Test 5: PASS")


def main():
    test_1_fresh_db()
    test_2_pre_phase2_baseline()
    test_3_import_vocab()
    test_4_sentence_word_links()
    test_5_lesson_index()
    print("\n*** ALL PHASE 2 E2E TESTS PASSED ***")


if __name__ == "__main__":
    main()
