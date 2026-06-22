#!/usr/bin/env python3
"""
export_bundle.py — dump CMS content + audio into a staging bundle.

Used by ./scripts/cms/bake_image.sh to stage db-image build inputs.
Staging is a plain directory (no tar — keeps `docker build` inputs
inspectable). Output layout:

    {--output-dir}/data-bundle-vYYYYMMDD-HHMMSS/
    ├── dump.sql       pg_dump of 3 content tables (schema + data)
    ├── audio/         MP3s copied from --audio-dir / $AUDIO_DIR
    └── meta.json      bundle provenance + row/audio counts

Tools required:
  pg_dump, psql   (from postgresql-client — the CMS host already has
                   them because it runs the db)

Why pg_dump (not SQLAlchemy):
  - Canonical SQL output, no risk of model-vs-DB drift.
  - The CMS host already runs postgres; no extra Python deps.
  - pg_dump handles FK dependency order automatically (libs → words → sentences).

Why --clean --if-exists:
  - The dump.sql is loaded by postgres:15-alpine on first init against
    an empty database. `--clean` makes the SQL idempotent (DROP TABLE
    IF EXISTS before CREATE) so re-runs against a non-empty db don't
    fail. Safe because we're targeting empty dbs anyway.

Why --no-owner --no-acl:
  - The image sets POSTGRES_USER / POSTGRES_DB via env. We don't want
    pg_dump emitting OWNER TO / GRANT statements referencing the CMS
    host's user, which wouldn't exist in the image's runtime user.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# Schema decision: keep the 3 tables (vocabulary_libs / vocabulary_words /
# sentences). See cms/db-image/README.md for rationale. The cms host's
# import_vocab.py populates them; export_bundle.py dumps them; the
# runtime serves them read-only.
CONTENT_TABLES = ["vocabulary_libs", "vocabulary_words", "sentences"]


def run(cmd, **kw):
    """subprocess.run(check=True) wrapper — raises CalledProcessError on fail."""
    return subprocess.run(cmd, check=True, **kw)


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (export it from .env.cms)")
    return url


def make_bundle_dir(parent: Path) -> Path:
    """Create {parent}/data-bundle-vYYYYMMDD-HHMMSS/."""
    parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    bundle = parent / f"data-bundle-v{ts}"
    bundle.mkdir(exist_ok=False)
    return bundle


def pg_dump_content(db_url: str, out_sql: Path) -> None:
    """pg_dump the 3 content tables (schema + data) into out_sql."""
    cmd = [
        "pg_dump",
        db_url,
        "--no-owner",  # no OWNER TO statements
        "--no-acl",    # no GRANT/REVOKE statements
        "--clean",     # DROP TABLE IF EXISTS before CREATE
        "--if-exists",
        "--table=vocabulary_libs",
        "--table=vocabulary_words",
        "--table=sentences",
    ]
    with out_sql.open("w", encoding="utf-8") as f:
        run(cmd, stdout=f)


def count_rows(db_url: str) -> dict:
    """Return {table: row_count} via psql -tAc 'SELECT count(*)...'."""
    counts = {}
    for table in CONTENT_TABLES:
        result = run(
            ["psql", db_url, "-tAc", f"SELECT count(*) FROM {table}"],
            capture_output=True,
            text=True,
        )
        counts[table] = int(result.stdout.strip() or "0")
    return counts


def copy_audio(audio_dir: str | None, dest: Path) -> int:
    """Copy audio_dir/* into dest. Returns file count."""
    dest.mkdir(parents=True, exist_ok=True)
    if not audio_dir:
        return 0
    src = Path(audio_dir)
    if not src.is_dir():
        return 0
    count = 0
    for f in src.iterdir():
        if f.is_file():
            shutil.copy2(f, dest / f.name)
            count += 1
    return count


def write_meta(bundle: Path, db_url: str, counts: dict, audio_count: int) -> None:
    """Write meta.json with bundle provenance + counts."""
    parsed = urlparse(db_url)
    meta = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "db_host": f"{parsed.hostname}:{parsed.port or 5432}/{parsed.path.lstrip('/')}",
        "row_counts": counts,
        "audio_count": audio_count,
    }
    (bundle / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dump CMS content + audio into a staging bundle.",
    )
    parser.add_argument(
        "--output-dir",
        default=".bake-staging",
        help="Parent directory; bundle is created as <output-dir>/data-bundle-v.../",
    )
    parser.add_argument(
        "--content-only",
        action="store_true",
        help="Skip audio copy. Useful for testing the SQL side alone.",
    )
    parser.add_argument(
        "--no-tar",
        action="store_true",
        help="Deprecated no-op (kept for compat with bake_image.sh CLI).",
    )
    parser.add_argument(
        "--keep-staging",
        action="store_true",
        help="Keep --output-dir on error. Default: delete bundle on error.",
    )
    parser.add_argument(
        "--audio-dir",
        default=os.environ.get("AUDIO_DIR"),
        help="Source audio directory. Default: $AUDIO_DIR from .env.cms.",
    )
    args = parser.parse_args()

    output_parent = Path(args.output_dir).resolve()
    bundle = make_bundle_dir(output_parent)

    try:
        db_url = get_database_url()
        db_host = f"{urlparse(db_url).hostname}:{urlparse(db_url).port or 5432}"
        print(f"[export_bundle] db:   {db_host}")
        print(f"[export_bundle] out:  {bundle}")

        # 1. pg_dump → dump.sql
        dump_sql = bundle / "dump.sql"
        pg_dump_content(db_url, dump_sql)
        print(f"[export_bundle] dump: {dump_sql.stat().st_size:,} bytes")

        # 2. row counts (for the manifest)
        counts = count_rows(db_url)
        for table, n in counts.items():
            print(f"[export_bundle]       {table}: {n} row(s)")

        # 3. audio
        if args.content_only:
            audio_count = 0
            print(f"[export_bundle]       --content-only: skipping audio")
        else:
            audio_dest = bundle / "audio"
            audio_count = copy_audio(args.audio_dir, audio_dest)
            print(f"[export_bundle]       audio: {audio_count} file(s)")

        # 4. meta.json (provenance)
        write_meta(bundle, db_url, counts, audio_count)
        print(f"[export_bundle] OK   ({bundle})")
    except Exception as exc:
        if not args.keep_staging:
            print(
                f"[export_bundle] error ({exc}) — cleaning up {bundle}",
                file=sys.stderr,
            )
            shutil.rmtree(bundle, ignore_errors=True)
        raise


if __name__ == "__main__":
    main()