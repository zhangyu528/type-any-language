#!/bin/bash
#
# db/scripts/init_schema.sh — apply the base schema + run pending
# migrations to a fresh / existing cloud db. Idempotent
# (CREATE TABLE IF NOT EXISTS + migration runner skip-on-already-applied).
#
# Why this lives in db/scripts/ instead of cms/scripts/:
#   The shell entry point stays in db/scripts/ so the operator workflow
#   (`./db/scripts/init_schema.sh` from any host with DATABASE_URL)
#   doesn't change. The actual Python implementation moved to
#   backend/init_schema.py — co-located with backend/app/models/*.py
#   since "model + migration + bootstrap" are a coupled trio. db/
#   only holds importer (CMS staging → cloud db UPSERT) and bootstrap
#   shell scripts (ROLE/DB/GRANT, DSN file writing).
#
#   This shell script wraps `python -m init_schema` (run with
#   PYTHONPATH=backend:db so it can find both backend/init_schema.py
#   itself AND db/db_url.py for the defensive DATABASE_URL
#   fallback).
#
# Usage:
#   # 1. Make sure DATABASE_URL points at the cloud db (or self-hosted db).
#   #    cloud-db: ./ops/{dev,prod}/setup.sh bootstrap writes .secrets/database_url;
#   #              db/scripts/lib.sh::resolve_*_db_url exports DATABASE_URL before this runs.
#   #    self-host / CI: `eval "$(scripts/secrets/fetch_secrets.sh eval-db)"`
#   #                    or export DATABASE_URL directly.
#   # 2. Apply the base schema + migrations.
#   ./db/scripts/init_schema.sh
#
# Idempotent: safe to re-run on a db that already has the tables.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/../../ops/lib.sh"

# Assemble DATABASE_URL — see ops/lib.sh::db_assemble_url. The Python
# modules (init_schema, importer, migrations.runner) no longer import
# cms_pipeline.env, which used to do this in Python.
if [ -z "${DATABASE_URL:-}" ]; then
    if ! db_assemble_url; then
        exit 1
    fi
fi

# Force UTF-8 IO so migration print lines (some contain ↔, ✓, etc.)
# don't blow up on Windows GBK consoles.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# PYTHONPATH=backend:db — the init_schema + migrations Python packages
# live at backend/ (init_schema.py and migrations/); the db_url
# defensive fallback lives at db/db_url.py. Both directories
# must be on PYTHONPATH so init_schema can import either.
PYTHONPATH="${PROJECT_DIR}/backend${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m init_schema "$@"