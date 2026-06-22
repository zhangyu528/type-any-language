#!/usr/bin/env python3
"""
import_vocab.py — read db/content/vocabulary/*.csv → populate vocabulary_libs
+ vocabulary_words tables.

Idempotent:
  - Per lib (level), if a row with that `level` exists, skip insertion
    (CSV is treated as source-of-truth only for empty dbs).
  - Pass --force to truncate and re-import (careful: destroys existing
    word_count stats).

CSV format (header required):
    word,phonetic,translation,part_of_speech

Each lib (level) has its own CSV: beginner.csv, cet4.csv, cet6.csv, ielts.csv.

Usage:
    python -m pipeline.import_vocab                # import all CSVs
    python -m pipeline.import_vocab beginner       # one lib only
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
else:
    from .env import setup_env, load_config

import psycopg2

# Map: lib_name in CSVs ↔ display name + level
LIB_DEFS = {
    "beginner": {
        "display": "Beginner Vocabulary",
        "level":   "beginner",
    },
    "cet4": {
        "display": "CET-4",
        "level":   "cet4",
    },
    "cet6": {
        "display": "CET-6",
        "level":   "cet6",
    },
    "ielts": {
        "display": "IELTS",
        "level":   "ielts",
    },
}


def find_vocab_dir() -> Path:
    """Locate db/content/vocabulary/. Walks up to find the project root."""
    here = Path(__file__).resolve().parent
    while here != here.parent:
        candidate = here / "cms" / "content" / "vocabulary"
        if candidate.is_dir():
            return candidate
        here = here.parent
    sys.exit("db/content/vocabulary/ not found — are you running from the project root?")


def upsert_lib(conn, level: str, display: str, word_count: int, force: bool) -> str:
    """INSERT a vocabulary_libs row if missing; return its id."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM vocabulary_libs WHERE level = %s",
            (level,),
        )
        existing = cur.fetchone()

        if existing:
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
                return str(existing[0])

        lib_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO vocabulary_libs (id, name, level, word_count, created_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (lib_id, display, level, word_count, datetime.now(timezone.utc)),
        )
        return lib_id


def import_words(conn, lib_id: str, csv_path: Path) -> int:
    """INSERT every row from csv_path into vocabulary_words. Returns count."""
    count = 0
    rows = []
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = (row.get("word") or "").strip().lower()
            if not word:
                continue
            rows.append((
                str(uuid.uuid4()),
                lib_id,
                word,
                (row.get("phonetic") or "").strip(),
                (row.get("translation") or "").strip(),
                (row.get("part_of_speech") or "").strip(),
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
                (id, lib_id, word, phonetic, translation, part_of_speech, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
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


def import_one(conn, name: str, vocab_dir: Path, force: bool, dry_run: bool) -> dict:
    csv_path = vocab_dir / f"{name}.csv"
    if not csv_path.is_file():
        return {"name": name, "status": "missing", "csv": str(csv_path)}

    defn = LIB_DEFS.get(name)
    if defn is None:
        return {"name": name, "status": "unknown", "csv": str(csv_path)}

    # Quick count of non-empty `word` cells (matches the actual insert count).
    n = 0
    with csv_path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("word") or "").strip():
                n += 1

    if dry_run:
        return {"name": name, "status": "plan", "csv": str(csv_path), "rows": n, **defn}

    lib_id = upsert_lib(conn, defn["level"], defn["display"], n, force)
    inserted = import_words(conn, lib_id, csv_path)
    if not force:
        update_word_count(conn, lib_id, inserted)
    conn.commit()

    return {
        "name": name,
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
        choices=sorted(LIB_DEFS.keys()),
        help="Specific lib to import (default: all found).",
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
    cfg = load_config()  # noqa: F841 — validates .env.cms

    vocab_dir = find_vocab_dir()
    targets = [args.lib] if args.lib else sorted(LIB_DEFS.keys())

    print(f"[import_vocab] vocab dir: {vocab_dir}")
    print(f"[import_vocab] libs:      {', '.join(targets)}")
    print(f"[import_vocab] mode:      {'dry-run' if args.dry_run else 'force' if args.force else 'skip-existing'}")
    print()

    results = []
    if args.dry_run:
        for name in targets:
            results.append(import_one(None, name, vocab_dir, args.force, dry_run=True))
    else:
        with psycopg2.connect(cfg.database_url) as conn:
            for name in targets:
                results.append(import_one(conn, name, vocab_dir, args.force, dry_run=False))

    # Summary
    for r in results:
        if r["status"] == "missing":
            print(f"  ✗ {r['name']}: csv not found at {r['csv']}")
        elif r["status"] == "unknown":
            print(f"  ? {r['name']}: unknown lib (not in LIB_DEFS)")
        else:
            print(f"  ✓ {r['name']:10s} {r['status']:13s} {r.get('rows', 0)} rows")


if __name__ == "__main__":
    main()