#!/bin/bash
#
# db/scripts/import_staging.sh — read CMS staging files and UPSERT into
# the connected db. The bridge between "CMS pipeline produced files"
# and "the db has the new content".
#
# Why this lives in db/scripts/:
#   This is the canonical Load step of the ETL — CMS produces files
#   in cms/content/, this script (via importer) writes them to the db.
#   The importer is the one place that knows both file format and
#   schema, so it lives with the schema (db/). This shell is its entry
#   point.
#
# Idempotent: re-running only inserts new rows; existing rows are
# skipped (vocab) or updated in place (sentences, audio_url).
# Safe to re-run after editing CSVs or after the TTS step fills
# in audio_url.
#
# Usage:
#   ./db/scripts/import_staging.sh               # all in one go
#   ./db/scripts/import_staging.sh vocab        # just vocab tables
#   ./db/scripts/import_staging.sh sentences   # just sentences (incl. audio_url)
#   ./db/scripts/import_staging.sh --dry-run    # show what would happen
#
# Requires DATABASE_URL in env. Two ways to set it:
#   - container: `docker compose exec backend ./db/scripts/import_staging.sh`
#     (DATABASE_URL injected by compose from the environment: block)
#   - host:      `export DATABASE_URL=postgresql://... && ./db/scripts/import_staging.sh`

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Self-contained: db/scripts owns its helpers (db_assemble_url + logging),
# no ops/ dependency.
source "$SCRIPT_DIR/lib.sh"

# Assemble DATABASE_URL — see db/scripts/lib.sh::db_assemble_url. The importer
# no longer imports pipeline.env, which used to do this in Python.
if [ -z "${DATABASE_URL:-}" ]; then
    if ! db_assemble_url; then
        exit 1
    fi
fi

# Force UTF-8 IO so importer print lines (✓ / ✗ / box-drawing in
# per-lib summaries) don't blow up on Windows GBK consoles.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# PYTHONPATH=db — the importer lives at db/. Convert PROJECT_DIR to a
# Windows path (mixed slashes are fine) so Windows Python can find the
# module: pure POSIX paths in PYTHONPATH don't resolve on Windows-native
# Python (it sees `/d/work/...` as a root-relative path).
#
# We OVERRIDE PYTHONPATH (don't append to it) because the inherited
# PYTHONPATH may use `:` separators (Unix-style, set by some tooling)
# which Python on Windows would misinterpret as part of one path. Setting
# just what we need is robust and predictable.
PROJECT_DIR_WIN="$PROJECT_DIR"
if command -v cygpath >/dev/null 2>&1; then
    PROJECT_DIR_WIN="$(cygpath -w "$PROJECT_DIR")"
fi
# PYTHON_BIN is set by backend/scripts/dev.py to the absolute path of
# the venv python (sys.executable). Defaulting to `python3` keeps the
# script usable standalone (e.g. `docker compose exec backend ./db/scripts/import_staging.sh`
# — there the venv python IS the container's python3 and PATH lookup works).
PYTHON_BIN="${PYTHON_BIN:-python3}"
PYTHONPATH="${PROJECT_DIR_WIN}/db" \
    "$PYTHON_BIN" -m importer "$@"