#!/usr/bin/env python3
"""
import_vocab.py — read vocabulary CSVs (from cms/source/manifest.yaml)
→ write per-lib JSON files to cms/.local/staging/vocabulary/<lib>.json.

This module is a **pure producer** in the CMS pipeline:
  - Reads CSVs (declarative, manifest-driven)
  - Writes JSON files (the data the db side will later import)
  - Does NOT touch the db

The data flow now is:
    cms/source/vocabulary/*.csv   ← operator-maintained
        ↓
    [import_vocab.py]              ← THIS MODULE
        ↓
    cms/.local/staging/vocabulary/<lib>.json
        ↓
    [db/scripts/import_staging.sh + dbtools.importer]
        ↓
    db (vocabulary_libs, vocabulary_words)

Why the split:
  - The CMS pipeline doesn't know db exists — it just produces
    content files. The db schema / connection / table structure
    are db's concern.
  - Failed CSV parsing is recoverable: fix the CSV + re-run, no
    db roundtrip.
  - Different runtimes: content can be produced in CI / cron /
    on a laptop without any db connection.

CSV format (header required):
    word,phonetic,translation,part_of_speech,frequency,register,domain,example,tags

Only `word` is required. Trailing metadata columns are optional:
  - frequency (int)   — word-frequency rank / count
  - register  (str)   — formal | neutral | informal | slang
  - domain    (str)   — business | travel | tech | ...
  - example   (str)   — a short example sentence
  - tags      (str)   — semicolon-separated ("idiom;phrasal-verb"),
                         parsed into a list

Output JSON format (one file per lib):
    {
      "level": "beginner",
      "display": "Beginner Vocabulary",
      "description": "...",
      "words": [
        {"word": "boat", "phonetic": "", "translation": "...",
         "part_of_speech": "n", "frequency": null, "register": null,
         "domain": null, "example": null, "tags": null},
        ...
      ]
    }

Usage:
    python -m cms_pipeline.import_vocab                # all libs in manifest
    python -m cms_pipeline.import_vocab cet4           # one lib only (by manifest id)
    python -m cms_pipeline.import_vocab --dry-run      # show plan, no file writes
"""
import argparse
import csv
import json
import os
import sys
from pathlib import Path

# Allow running this file directly (python import_vocab.py) AND as
# `python -m cms_pipeline.import_vocab` from the project root.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
    from cms_pipeline.manifest import LibDef, load_manifest
else:
    from .manifest import LibDef, load_manifest


def find_project_root() -> Path:
    """Project root = 4 hops up from cms/cms_pipeline/import_vocab.py.

    Walk: import_vocab.py → cms/ → tools/ → cms/ → project_root.

    This module lives at cms/cms_pipeline/ (NOT db/tools/dbtools/), so the
    walk depth differs from the dbtools modules. Don't relocate this
    file without updating the count.
    """
    return Path(__file__).resolve().parent.parent.parent.parent


def find_staging_dir() -> Path:
    """Where vocab/sentences files go. Default: cms/.local/staging/.

    Override via CMS_STAGING_DIR (rare; for tests).
    """
    env = os.environ.get("CMS_STAGING_DIR", "").strip()
    if env:
        return Path(env)
    return find_project_root() / "cms" / ".local" / "staging"


def parse_row(row: dict) -> dict | None:
    """Convert a csv.DictReader row to the importer's expected dict shape.

    Returns None for blank rows (no `word` cell). Coerces / cleans:
      - word: lowercased + stripped
      - frequency: int or None
      - tags: list or None
    """
    word = (row.get("word") or "").strip().lower()
    if not word:
        return None

    frequency_raw = (row.get("frequency") or "").strip()
    frequency = None
    if frequency_raw:
        try:
            frequency = int(frequency_raw)
        except ValueError:
            # Tolerate garbage: log + skip the cell. The user can re-fix
            # the CSV. We don't abort the whole import.
            print(
                f"[import_vocab] bad frequency {frequency_raw!r} for {word!r}, "
                f"storing NULL"
            )
            frequency = None

    tags_raw = (row.get("tags") or "").strip()
    if tags_raw:
        tags = [t.strip() for t in tags_raw.split(";") if t.strip()]
        tags = tags or None
    else:
        tags = None

    return {
        "word": word,
        "phonetic": (row.get("phonetic") or "").strip(),
        "translation": (row.get("translation") or "").strip(),
        "part_of_speech": (row.get("part_of_speech") or "").strip(),
        "frequency": frequency,
        "register": (row.get("register") or "").strip() or None,
        "domain": (row.get("domain") or "").strip() or None,
        "example": (row.get("example") or "").strip() or None,
        "tags": tags,
    }


def read_csv_rows(csv_path: Path) -> list:
    """Read a CSV → list of word dicts. Filters blank rows."""
    rows = []
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            parsed = parse_row(row)
            if parsed is not None:
                rows.append(parsed)
    return rows


def write_staging_file(staging_dir: Path, lib: LibDef, rows: list, dry_run: bool) -> dict:
    """Write one <lib>.json to staging_dir/vocabulary/.

    Returns a status dict suitable for the per-lib summary line.
    """
    if not lib.csv_exists:
        return {"name": lib.id, "status": "missing", "csv": str(lib.csv_path)}

    out_dir = staging_dir / "vocabulary"
    out_path = out_dir / f"{lib.level}.json"

    if dry_run:
        return {
            "name": lib.id,
            "status": "plan",
            "csv": str(lib.csv_path),
            "out": str(out_path),
            "rows": len(rows),
            "display": lib.display,
            "level": lib.level,
            "description": lib.description,
            "difficulties": list(lib.difficulties),
            "lesson_size": lib.lesson_size,
        }

    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "level": lib.level,
        "display": lib.display,
        "description": lib.description,
        "lesson_size": lib.lesson_size,
        "words": rows,
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "name": lib.id,
        "status": "written",
        "csv": str(lib.csv_path),
        "out": str(out_path),
        "rows": len(rows),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read vocabulary CSVs and write per-lib JSON files to staging.",
    )
    parser.add_argument(
        "lib",
        nargs="?",
        default=None,
        help="Specific lib to write by manifest id (default: all libs in manifest).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be written without creating any files.",
    )
    args = parser.parse_args()

    manifest = load_manifest()
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

    staging = find_staging_dir()
    if not args.dry_run:
        staging.mkdir(parents=True, exist_ok=True)

    print(f"[import_vocab] manifest version={manifest.version}")
    print(f"[import_vocab] libs:        {', '.join(l.id for l in targets)}")
    print(f"[import_vocab] staging:     {staging}")
    print(f"[import_vocab] mode:        {'dry-run' if args.dry_run else 'write'}")
    print()

    results = []
    for lib in targets:
        if not lib.csv_exists:
            results.append(write_staging_file(staging, lib, [], dry_run=True))
            continue
        rows = read_csv_rows(lib.csv_path)
        results.append(write_staging_file(staging, lib, rows, args.dry_run))

    for r in results:
        if r["status"] == "missing":
            print(f"  !! {r['name']}: csv not found at {r['csv']}")
        elif r["status"] == "plan":
            print(f"  -- {r['name']:10s} {'plan':13s} {r['rows']} rows -> {r['out']}")
        elif r["status"] == "written":
            print(f"  ok {r['name']:10s} {'written':13s} {r['rows']} rows -> {r['out']}")
        else:
            print(f"  ?? {r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())