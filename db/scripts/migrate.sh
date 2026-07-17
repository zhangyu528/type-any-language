#!/bin/bash
#
# db/scripts/migrate.sh — apply pending schema migrations to a populated
# source db. Idempotent (runner.py stamps applied versions in
# schema_migrations; re-runs are no-ops).
#
# Why this lives in db/scripts/:
#   Schema migration is a db concern. The Python implementation
#   (dbtools.migrations.runner) lives at db/tools/dbtools/migrations/.
#
# Usage:
#   # 1. Make sure a populated db is reachable.
#   ./db/scripts/source_db.sh ensure
#   # 2. (first time) init schema, then apply migrations.
#   ./db/scripts/init_schema.sh
#   ./db/scripts/migrate.sh
#   # On subsequent runs (after editing db/tools/dbtools/migrations/versions/):
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

# PYTHONPATH=db/tools — the migrations Python package lives at
# db/tools/dbtools/migrations/.
PYTHONPATH="${PROJECT_DIR}/db/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m dbtools.migrations.runner "$@"