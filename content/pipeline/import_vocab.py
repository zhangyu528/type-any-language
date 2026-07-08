#!/usr/bin/env python3
"""
import_vocab.py — read vocabulary CSVs (declared in db/content/manifest.yaml)
→ populate vocabulary_libs + vocabulary_words tables.

The lib list comes from the manifest (single source of truth for content
catalog), not from a hardcoded dict in this file. To add a new lib:
  1. add an entry to db/content/manifest.yaml's `libs:`
  2. drop the CSV at the declared path

No Python edit required.

Idempotent:
  - Per lib (level), if a row with that `level` exists, skip insertion
    (CSV is treated as source-of-truth only for empty dbs).
  - Pass --force to truncate and re-import (careful: destroys existing
    word_count stats).

CSV format (header required):
    word,phonetic,translation,part_of_speech,frequency,register,domain,example,tags

Only `word` is required. The 5 trailing metadata columns are optional:
  - frequency (int)    — word-frequency rank / count
  - register   (str)   — formal | neutral | informal | slang
  - domain     (str)   — business | travel | tech | ...
  - example    (str)   — a short example sentence
  - tags       (str)   — semicolon-separated, e.g. "idiom;phrasal-verb"
                         parsed into a TEXT[] column

Old CSVs with only the first 4 columns still work; the new fields land as
NULL. New CSVs can carry any subset of the optional columns.

Usage:
    python -m pipeline.import_vocab                # import all libs in manifest
    python -m pipeline.import_vocab cet4           # one lib only (by manifest id)
    python -m pipeline.import_vocab --force        # truncate + re-import
    python -m pipeline.import_vocab --dry-run      # show plan, no writes
"""
import argparse
import csv
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Allow running this file directly (python import_vocab.py) AND as
# `python -m pipeline.import_vocab` from the project root.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from pipeline.env import setup_env, load_config
    from pipeline.manifest import LibDef, load_manifest
else:
    from .env import setup_env, load_config
    from .manifest import LibDef, load_manifest

import psycopg2


def upsert_lib(conn, level: str, display: str, description: str | None,
               word_count: int, force: bool) -> str | None:
    """INSERT a vocabulary_libs row if missing; return its id.

    Returns None when the lib already exists and `force=False`. The caller
    uses that signal to SKIP re-inserting vocabulary_words — the CSV is
    treated as source-of-truth only for empty dbs. (Previous behavior
    returned the existing id but didn't gate the caller's insert, which
    caused double-insertion on every re-run.)

    On the re-import path (`force=True`) we always UPDATE the description
    too — the manifest is the single source of truth, so editing the tagline
    there should be reflected in the runtime db on the next sync.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM vocabulary_libs WHERE level = %s",
            (level,),
        )
        existing = cur.fetchone()

        if existing:
            # Always sync the description on re-import. Cheap (single-row
            # UPDATE on PK) and lets operators tweak taglines without a
            # migration.
            cur.execute(
                "UPDATE vocabulary_libs SET description = %s WHERE id = %s",
                (description, existing[0]),
            )
            if force:
                cur.execute(
                    "DELETE FROM vocabulary_words WHERE lib_id = %s",
                    (existing[0],),
                )
                cur.execute(
                    "UPDATE vocabulary_libs SET word_count = 0 WHERE id = %s",
                    (existing[0],),
                )
                return str(existing[0])
            else:
                print(f"[import_vocab] {level}: already imported ({word_count} words in CSV skipped)")
                return None

        lib_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO vocabulary_libs (id, name, level, description, word_count, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (lib_id, display, level, description, word_count, datetime.now(timezone.utc)),
        )
        return lib_id


def import_words(conn, lib_id: str, csv_path: Path) -> int:
    """INSERT every row from csv_path into vocabulary_words. Returns count.

    Reads the 5 trailing metadata columns (frequency / register / domain /
    example / tags) when present, defaults them to NULL otherwise. Backwards
    compatible with CSVs that only carry word,phonetic,translation,part_of_speech.

    `tags` is semicolon-separated in the CSV ("idiom;phrasal-verb") and
    parsed into a Python list (stored as TEXT[] in Postgres).
    """
    count = 0
    rows = []
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = (row.get("word") or "").strip().lower()
            if not word:
                continue

            # Optional metadata. Empty cell -> NULL, not "" -- matches the
            # column's nullable contract in the schema (migration 0002).
            frequency_raw = (row.get("frequency") or "").strip()
            try:
                frequency = int(frequency_raw) if frequency_raw else None
            except ValueError:
                # Tolerate garbage: log + skip the cell rather than abort
                # the whole import. The user can re-fix the CSV and --force.
                print(
                    f"[import_vocab] {csv_path.name}: bad frequency {frequency_raw!r} "
                    f"for {word!r}, storing NULL"
                )
                frequency = None

            register = (row.get("register") or "").strip() or None
            domain = (row.get("domain") or "").strip() or None
            example = (row.get("example") or "").strip() or None

            tags_raw = (row.get("tags") or "").strip()
            if tags_raw:
                tags = [t.strip() for t in tags_raw.split(";") if t.strip()]
                if not tags:
                    tags = None
            else:
                tags = None

            rows.append((
                str(uuid.uuid4()),
                lib_id,
                word,
                (row.get("phonetic") or "").strip(),
                (row.get("translation") or "").strip(),
                (row.get("part_of_speech") or "").strip(),
                frequency,
                register,
                domain,
                example,
                tags,
                datetime.now(timezone.utc),
            ))
            count += 1

    if not rows:
        return 0

    with conn.cursor() as cur:
        # executemany is fine for ~thousands of rows; for bigger sets a COPY
        # would be faster. CSVs are 200KB-300KB ≈ 1500-2500 words each.
        cur.executemany(
            """
            INSERT INTO vocabulary_words
                (id, lib_id, word, phonetic, translation, part_of_speech,
                 frequency, register, domain, example, tags, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )
    return count


def update_word_count(conn, lib_id: str, count: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE vocabulary_libs SET word_count = %s WHERE id = %s",
            (count, lib_id),
        )


def assign_lesson_indexes(conn, lib_id: str, lesson_size: int) -> int:
    """Stamp `lesson_index` on every word of `lib_id`.

    The grouping is positional: words 1..N → lesson 1, (N+1)..2N → lesson 2, etc.
    Ordering matches what `import_words` produces (created_at, id), so the
    first row inserted ends up as the first word of lesson 1.

    Idempotent: re-runs overwrite the previous lesson_index with the same
    value (positional math is stable). If the operator changes lesson_size
    in the manifest and re-syncs, this function will re-bucket correctly.
    """
    if lesson_size <= 0:
        raise ValueError(f"lesson_size must be > 0, got {lesson_size}")
    with conn.cursor() as cur:
        cur.execute(
            f"""
            WITH ranked AS (
                SELECT id,
                       ((ROW_NUMBER() OVER (
                           ORDER BY created_at, id
                       ) - 1) / %s) + 1 AS new_lesson_index
                FROM vocabulary_words
                WHERE lib_id = %s
            )
            UPDATE vocabulary_words vw
            SET lesson_index = ranked.new_lesson_index
            FROM ranked
            WHERE vw.id = ranked.id
            """,
            (lesson_size, lib_id),
        )
    return cur.rowcount


def import_one(conn, lib: LibDef, force: bool, dry_run: bool) -> dict:
    """Import one lib. Manifest-driven — lib's display/level/csv are pre-resolved."""
    csv_path = lib.csv_path
    if not lib.csv_exists:
        return {"name": lib.id, "status": "missing", "csv": str(csv_path)}

    # Quick count of non-empty `word` cells (matches the actual insert count).
    n = 0
    with csv_path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("word") or "").strip():
                n += 1

    if dry_run:
        return {
            "name": lib.id,
            "status": "plan",
            "csv": str(csv_path),
            "rows": n,
            "display": lib.display,
            "level": lib.level,
            "description": lib.description,
            "difficulties": list(lib.difficulties),
        }

    lib_id = upsert_lib(conn, lib.level, lib.display, lib.description, n, force)
    if lib_id is None:
        # skip-existing path: lib was already imported, CSV is a no-op.
        # Don't insert words, don't touch word_count, don't commit.
        return {
            "name": lib.id,
            "status": "skipped",
            "csv": str(csv_path),
            "rows": 0,
            "lib_id": None,
        }

    inserted = import_words(conn, lib_id, csv_path)
    if not force:
        update_word_count(conn, lib_id, inserted)
    # Re-bucket lesson_index even on re-import (--force) so changing
    # lesson_size in the manifest takes effect on the next sync.
    assign_lesson_indexes(conn, lib_id, lib.lesson_size)
    conn.commit()

    return {
        "name": lib.id,
        "status": "imported" if not force or inserted else "re-imported",
        "csv": str(csv_path),
        "rows": inserted,
        "lib_id": lib_id,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import vocabulary CSVs into the CMS DB.")
    parser.add_argument(
        "lib",
        nargs="?",
        default=None,
        help="Specific lib to import by manifest id (default: all libs in manifest).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Truncate existing words for the lib before re-importing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the import plan without writing to DB.",
    )
    args = parser.parse_args()

    setup_env()
    cfg = load_config()  # noqa: F841 — validates .env.db

    manifest = load_manifest()

    # Filter by `--lib` if specified.
    if args.lib is not None:
        target = manifest.get_lib(args.lib)
        if target is None:
            sys.exit(
                f"unknown lib {args.lib!r} -- declared libs in manifest: "
                f"{', '.join(manifest.all_lib_ids())}"
            )
        targets = [target]
    else:
        targets = list(manifest.all_libs())

    print(f"[import_vocab] manifest version={manifest.version}")
    print(f"[import_vocab] libs:        {', '.join(l.id for l in targets)}")
    print(f"[import_vocab] mode:        {'dry-run' if args.dry_run else 'force' if args.force else 'skip-existing'}")
    print()

    results = []
    if args.dry_run:
        for lib in targets:
            results.append(import_one(None, lib, args.force, dry_run=True))
    else:
        with psycopg2.connect(cfg.database_url) as conn:
            for lib in targets:
                results.append(import_one(conn, lib, args.force, dry_run=False))

    # Summary
    # ASCII-only status glyphs: Windows console (GBK / cp936) can't encode
    # the nicer Unicode ticks used in earlier versions. 'ok' / 'skip' / '!!'
    # are readable everywhere and grep-friendly.
    for r in results:
        if r["status"] == "missing":
            print(f"  !! {r['name']}: csv not found at {r['csv']}")
        elif r["status"] == "unknown":
            print(f"  ?? {r['name']}: unknown lib (not in manifest)")
        elif r["status"] == "skipped":
            print(f"  -- {r['name']:10s} {'skipped':13s} (already imported, CSV not re-read)")
        else:
            print(f"  ok {r['name']:10s} {r['status']:13s} {r.get('rows', 0)} rows")


if __name__ == "__main__":
    main()