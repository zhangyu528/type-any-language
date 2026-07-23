#!/bin/bash
#
# db/scripts/migrate.sh — apply pending schema migrations to the
# connected db. Idempotent (runner.py stamps applied versions in
# schema_migrations; re-runs are no-ops).
#
# Where the migration Python code lives:
#   The runner + versions/ live at backend/migrations/. db/scripts/
#   keeps this entry-point shell wrapper so the operator workflow
#   (`./db/scripts/migrate.sh` from any host) doesn't change.
#
# Default usage:
#   DATABASE_URL is expected in env. Two ways to set it:
#   - container: compose sets DATABASE_URL via the environment: block,
#     runs this script (or its caller) — typically via the backend
#     image's entrypoint.sh.
#   - host shell: `export DATABASE_URL=postgresql://user:pw@host:5432/db`
#     before running. For self-hosted / CI / ad-hoc CLI use.
#
#   # Self-hosted postgres without DATABASE_URL pre-set:
#   POSTGRES_PASSWORD=... ./db/scripts/migrate.sh
#
# Idempotent: re-runs are no-ops.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/../../ops/lib.sh"

# Assemble DATABASE_URL — see ops/lib.sh::db_assemble_url. The runner
# no longer imports pipeline.env, which used to do this in Python.
if [ -z "${DATABASE_URL:-}" ]; then
    if ! db_assemble_url; then
        exit 1
    fi
fi

# Force UTF-8 IO so migration print lines (some contain ↔, ✓, etc.)
# don't blow up on Windows GBK consoles.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# PYTHONPATH=backend — the migrations Python package lives at
# backend/migrations/. The runner needs backend/ on the path to find
# both `migrations.versions` (its own package) and the
# `db_url` defensive fallback (still at db/db_url.py).
PYTHONPATH="${PROJECT_DIR}/backend${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m migrations.runner "$@"