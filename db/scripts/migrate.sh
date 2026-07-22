#!/bin/bash
#
# db/scripts/migrate.sh — apply pending schema migrations to the
# connected db. Idempotent (runner.py stamps applied versions in
# schema_migrations; re-runs are no-ops).
#
# Why this lives in db/scripts/:
#   Schema migration is a db concern. The Python implementation
#   (dbtools.migrations.runner) lives at db/dbtools/migrations/.
#
# Usage:
#   # Default: requires DATABASE_URL in env (cloud-db path: the
#   # caller — CMS db-import driver or ops/dev/migrate.sh — has
#   # already exported it).
#   ./db/scripts/migrate.sh
#   # Self-hosted postgres without DATABASE_URL pre-set:
#   POSTGRES_PASSWORD=... ./db/scripts/migrate.sh
#   # On subsequent runs (after editing db/dbtools/migrations/versions/):
#   ./db/scripts/migrate.sh
#
# Idempotent: re-runs are no-ops.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/../../ops/lib.sh"

# Assemble DATABASE_URL — see ops/lib.sh::db_assemble_url. The runner
# no longer imports cms_pipeline.env, which used to do this in Python.
if [ -z "${DATABASE_URL:-}" ]; then
    if ! db_assemble_url; then
        exit 1
    fi
fi

# Force UTF-8 IO so migration print lines (some contain ↔, ✓, etc.)
# don't blow up on Windows GBK consoles.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# PYTHONPATH=db — the migrations Python package lives at
# db/dbtools/migrations/.
PYTHONPATH="${PROJECT_DIR}/db${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m dbtools.migrations.runner "$@"