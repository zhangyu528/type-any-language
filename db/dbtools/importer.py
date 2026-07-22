#!/usr/bin/env python3
"""
dbtools.importer — read CMS staging files → write to db.

This module is the **only** place that knows both "what CMS produced
in cms/staging/" and "what the db schema looks like". The
CMS pipeline (cms/cms_pipeline/{import_vocab,generate_sentences,
generate_audio}.py) produces JSON / JSONL files in staging/. This
importer reads them and applies the changes to the db.

Why a separate module:
  - CMS pipeline doesn't know db exists → writes pure data files
  - db side owns the data-import step (it's the inverse of pg_dump:
    we have SQL coming out of db, and now we have data going IN)
  - Re-running is safe: idempotent UPSERT pattern (see each
    importer below)
  - Failed imports can be retried without re-running the expensive
    AI/TTS steps

Staging layout produced by the CMS pipeline:
    cms/staging/
    ├── vocabulary/
    │   └── <lib>.json            # list of {word, phonetic, ...}
    ├── sentences/
    │   └── <lib>.jsonl           # one sentence per line
    └── manifest.json              # {libs: [{id, level, display, ...}]}

Why this is in dbtools/ (not cms/):
  - Same reasoning as dbtools/{init_schema,migrations,db_url}: it
    imports data into the db schema, which is db's concern
  - The CMS pipeline doesn't import from this module — it only
    produces files. The db/scripts/import_staging.sh wrapper is
    the only caller.

Usage:
    # All in one go
    python -m dbtools.importer all

    # One stage at a time (for re-runs)
    python -m dbtools.importer vocab
    python -m dbtools.importer sentences
    python -m dbtools.importer audio   # no-op for now: audio updates
                                       # are embedded in sentences.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from dbtools.db_url import resolve_database_url  # noqa: E402
else:
    from .db_url import resolve_database_url  # noqa: E402


def find_project_root() -> Path:
    """Project root = the dir containing `cms/` and `db/`.

    This file lives at db/dbtools/importer.py. The walk up the
    parents is: importer.py → dbtools/ → db/ → project_root.
    So `parent.parent.parent` (3 hops) lands on the project root.

    Note: when the module is run as `python -m dbtools.importer` from
    the project root (the common case), `__file__` is the full path
    to this .py file, so the walk works regardless of CWD.

    CAVEAT: this resolution only works if the script is at
    db/dbtools/importer.py relative to the project root. Do NOT
    relocate this file without updating this function.
    """
    return Path(__file__).resolve().parent.parent.parent


def find_staging_dir() -> Path:
    """The CMS pipeline writes here. Default: cms/staging/.
    Override via CMS_STAGING_DIR env var (rare — for tests)."""
    env = os.environ.get("CMS_STAGING_DIR", "").strip()
    if env:
        return Path(env)
    return find_project_root() / "cms" / "staging"


# ---------------------------------------------------------------------------
# Vocab importer
# ---------------------------------------------------------------------------
def import_vocab(staging: Path, conn) -> dict:
    """Read vocabulary/<lib>.json files and UPSERT lib + word rows.

    Returns stats: {lib_id: word_count_inserted}
    """
    import psycopg2.extras

    vocab_dir = staging / "vocabulary"
    if not vocab_dir.is_dir():
        return {}

    stats = {}
    with conn.cursor() as cur:
        for vocab_file in sorted(vocab_dir.glob("*.json")):
            lib = json.loads(vocab_file.read_text(encoding="utf-8"))
            lib_id = _upsert_lib(cur, lib)
            n_inserted = _upsert_words(cur, lib_id, lib["words"])
            cur.execute(
                "UPDATE vocabulary_libs SET word_count = %s WHERE id = %s",
                (n_inserted, lib_id),
            )
            stats[lib["level"]] = n_inserted
    return stats


def _upsert_lib(cur, lib: dict) -> str:
    """INSERT-or-UPDATE a vocabulary_libs row. Returns the id.

    The CSV is source-of-truth only for empty dbs: if a lib with
    this level already exists, we keep the existing id and only
    sync the description (the manifest's tagline is updated cheaply
    on every re-import; word_count is recomputed below from the
    words[] list).
    """
    level = lib["level"]
    cur.execute(
        "SELECT id FROM vocabulary_libs WHERE level = %s", (level,)
    )
    row = cur.fetchone()
    if row:
        lib_id = str(row[0])
        cur.execute(
            "UPDATE vocabulary_libs SET name = %s, description = %s WHERE id = %s",
            (lib["display"], lib.get("description", ""), lib_id),
        )
        return lib_id

    cur.execute(
        """
        INSERT INTO vocabulary_libs (id, name, level, description, word_count)
        VALUES (%s, %s, %s, %s, 0)
        RETURNING id
        """,
        (str(uuid.uuid4()), lib["display"], level, lib.get("description", "")),
    )
    return str(cur.fetchone()[0])


def _upsert_words(cur, lib_id: str, words: list) -> int:
    """Insert each word. Idempotent: skip if (lib_id, word) already exists.

    The CMS pipeline regenerates the staging file on every sync, so
    the words[] list reflects the current source CSV. Existing rows
    are preserved (idempotent INSERT).
    """
    n = 0
    for w in words:
        cur.execute(
            "SELECT 1 FROM vocabulary_words WHERE lib_id = %s AND word = %s",
            (lib_id, w["word"]),
        )
        if cur.fetchone():
            continue
        cur.execute(
            """
            INSERT INTO vocabulary_words (
                id, lib_id, word, phonetic, translation, part_of_speech,
                frequency, register, domain, example, tags, lesson_index
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """,
            (
                str(uuid.uuid4()),
                lib_id,
                w["word"],
                w.get("phonetic", ""),
                w.get("translation", ""),
                w.get("part_of_speech", ""),
                w.get("frequency"),
                w.get("register"),
                w.get("domain"),
                w.get("example"),
                # tags is a list; psycopg2 wraps it as ARRAY
                w.get("tags") or None,
                w.get("lesson_index"),
            ),
        )
        n += 1
    return n


# ---------------------------------------------------------------------------
# Sentence importer
# ---------------------------------------------------------------------------
def import_sentences(staging: Path, conn) -> dict:
    """Read sentences/<lib>.jsonl files and UPSERT sentence rows.

    Each line is a JSON object: {text, difficulty, audio_url?, ...}.
    Match key: (lib_id, text) — sentences are content-unique within
    a lib. Audio URLs are updated in place on re-import (they
    may be filled in later by the TTS pass).
    """
    import psycopg2.extras

    sent_dir = staging / "sentences"
    if not sent_dir.is_dir():
        return {}

    stats = {}
    with conn.cursor() as cur:
        for sent_file in sorted(sent_dir.glob("*.jsonl")):
            lib = _resolve_lib_id_by_filename(cur, sent_file)
            n_inserted = 0
            n_updated = 0
            for line in sent_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                s = json.loads(line)
                if _upsert_sentence(cur, lib, s):
                    n_inserted += 1
                else:
                    n_updated += 1
            stats[sent_file.stem] = {"inserted": n_inserted, "updated": n_updated}
    return stats


def _resolve_lib_id_by_filename(cur, sent_file: Path) -> str:
    """Map sentence file name (e.g. beginner.jsonl) to its vocabulary_libs id."""
    level = sent_file.stem
    cur.execute("SELECT id FROM vocabulary_libs WHERE level = %s", (level,))
    row = cur.fetchone()
    if not row:
        sys.exit(
            f"sentence file {sent_file.name}: no vocabulary_libs row with level={level!r}. "
            f"Run `python -m dbtools.importer vocab` first."
        )
    return str(row[0])


def _upsert_sentence(cur, lib_id: str, s: dict) -> bool:
    """INSERT-or-UPDATE a sentence. Returns True if inserted, False if updated.

    Match key: (lib_id, text). When re-running, audio_url and
    chinese_text are refreshed in place. Other fields are preserved
    on conflict (the CSV / AI output is treated as source-of-truth
    for those).
    """
    cur.execute(
        "SELECT id FROM sentences WHERE lib_id = %s AND text = %s",
        (lib_id, s["text"]),
    )
    row = cur.fetchone()
    if row:
        # Update audio_url + chinese_text (the fields that may be
        # filled in by a later pass).
        cur.execute(
            """
            UPDATE sentences
            SET audio_url = COALESCE(%s, audio_url),
                chinese_text = COALESCE(%s, chinese_text),
                difficulty = COALESCE(%s, difficulty)
            WHERE id = %s
            """,
            (s.get("audio_url"), s.get("chinese_text"),
             s.get("difficulty"), row[0]),
        )
        return False
    cur.execute(
        """
        INSERT INTO sentences (
            id, lib_id, text, chinese_text, audio_url, difficulty,
            target_words, topic, register, cefr, tags
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            str(uuid.uuid4()),
            lib_id,
            s["text"],
            s.get("chinese_text", ""),
            s.get("audio_url", ""),
            s.get("difficulty", "beginner"),
            s.get("target_words") or [],
            s.get("topic", ""),
            s.get("register", ""),
            s.get("cefr", ""),
            s.get("tags") or [],
        ),
    )
    return True


# ---------------------------------------------------------------------------
# Audio importer (no-op for now — audio updates ride along with sentences)
# ---------------------------------------------------------------------------
def import_audio(staging: Path, conn) -> dict:
    """Audio URLs are updated in-place by the sentences importer
    (audio_url field in the sentences.jsonl is re-read on every
    import_sentences call). This stub exists for ETL symmetry: the
    caller can request a 3-stage import and the audio step is a
    no-op (or could be extended later if audio metadata gets its
    own table).
    """
    return {}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read CMS staging files and write to db.",
    )
    parser.add_argument(
        "what",
        choices=["vocab", "sentences", "audio", "all"],
        help="What to import. 'all' runs vocab + sentences + audio in order.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be imported without writing to db.",
    )
    args = parser.parse_args()

    # Resolve DATABASE_URL straight from the process env. Caller is
    # expected to have either run `eval "$(scripts/secrets/fetch_secrets.sh
    # eval-db)"` (CMS host) or `ops/<host>/setup.sh bootstrap` (target host,
    # writes .secrets/database_url). See db/dbtools/db_url.py for the full
    # resolution chain.
    database_url = resolve_database_url()

    staging = find_staging_dir()
    if not staging.is_dir():
        print(f"[ERR] staging dir not found: {staging}", file=sys.stderr)
        print(f"      (run the CMS pipeline first: cms/run.sh)", file=sys.stderr)
        return 1

    stages = (["vocab", "sentences", "audio"]
              if args.what == "all"
              else [args.what])
    # audio before sentences? No: sentences importer's COALESCE picks
    # up audio_url if it's already set, so the order is vocab →
    # sentences (which may carry audio_url) → audio (no-op).
    import_order = ["vocab", "sentences", "audio"]
    stage_funcs = {
        "vocab": import_vocab,
        "sentences": import_sentences,
        "audio": import_audio,
    }

    if args.dry_run:
        print(f"[dry-run] staging dir: {staging}")
        for f in (staging / "vocabulary").glob("*.json") if (staging / "vocabulary").is_dir() else []:
            data = json.loads(f.read_text(encoding="utf-8"))
            print(f"[dry-run]   vocabulary/{f.name}: {len(data.get('words', []))} words")
        for f in (staging / "sentences").glob("*.jsonl") if (staging / "sentences").is_dir() else []:
            n = sum(1 for line in f.read_text(encoding="utf-8").splitlines() if line.strip())
            print(f"[dry-run]   sentences/{f.name}: {n} lines")
        return 0

    import psycopg2
    with psycopg2.connect(database_url) as conn:
        for stage in stages:
            stats = stage_funcs[stage](staging, conn)
            if stats:
                print(f"[importer] {stage}: {stats}")
        conn.commit()
    print("[importer] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())