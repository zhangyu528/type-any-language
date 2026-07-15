#!/bin/bash
#
# db/scripts/migrate.sh — apply pending schema migrations to a populated
# source db. Idempotent (runner.py stamps applied versions in
# schema_migrations; re-runs are no-ops).
#
# Why this lives in db/scripts/:
#   Schema migration is a db concern. The Python implementation
#   (dbtools.migrations.runner) now lives at db/tools/cms/migrations/
#   — the migration versions are owned by the db side. cms/cms_pipeline/
#   remains for the data-pipeline code only.
#
#   This shell script is the db-side entry point. It shells out to
#   `python -m dbtools.migrations.runner` — same package name ("cms")
#   as before, just resolved against a different directory.
#
# Usage:
#   # 1. Make sure a populated db is reachable.
#   ./db/scripts/source_db.sh ensure
#   # 2. (first time) init schema, then apply migrations.
#   ./db/scripts/init_schema.sh
#   ./db/scripts/migrate.sh
#   # On subsequent runs (after editing db/tools/cms/migrations/versions/):
#   ./db/scripts/migrate.sh
#
# Idempotent: re-runs are no-ops.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# PYTHONPATH=db/tools — the migrations Python package lives at
# db/tools/cms/migrations/. The package name is still "cms" (so
# internal imports `from dbtools.migrations.runner import ...` keep
# working), but the source is on db/tools not cms/tools.
PYTHONPATH="${PROJECT_DIR}/db/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m dbtools.migrations.runner "$@"