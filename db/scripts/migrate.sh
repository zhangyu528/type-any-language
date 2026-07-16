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
source "$SCRIPT_DIR/../../scripts/lib.sh"

# Assemble DATABASE_URL — same logic as db/scripts/build.sh (the runner
# no longer imports cms_pipeline.env, which used to do this in Python).
# Priority: explicit shell env > assembled from POSTGRES_PASSWORD
# (shell env or .secrets/postgres_password) + code defaults.
if [ -z "${DATABASE_URL:-}" ]; then
    POSTGRES_USER="${POSTGRES_USER:-english_user}"
    POSTGRES_DB="${POSTGRES_DB:-english_learning}"
    POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
    POSTGRES_PORT="${POSTGRES_PORT:-5432}"
    if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -f .secrets/postgres_password ]; then
        POSTGRES_PASSWORD="$(cat .secrets/postgres_password)"
    fi
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        err "POSTGRES_PASSWORD missing — export it, or copy .secrets/postgres_password from the dev/prod host"
        exit 1
    fi
    if command -v python3 &> /dev/null; then
        DATABASE_URL="$(POSTGRES_USER="$POSTGRES_USER" POSTGRES_DB="$POSTGRES_DB" POSTGRES_HOST="$POSTGRES_HOST" POSTGRES_PORT="$POSTGRES_PORT" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            python3 -c 'import os, urllib.parse; print("postgresql://%s:%s@%s:%s/%s" % (urllib.parse.quote(os.environ["POSTGRES_USER"], safe=""), urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""), os.environ["POSTGRES_HOST"], os.environ["POSTGRES_PORT"], os.environ["POSTGRES_DB"]))')"
    else
        DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
    fi
    export DATABASE_URL
fi

# PYTHONPATH=db/tools — the migrations Python package lives at
# db/tools/dbtools/migrations/.
PYTHONPATH="${PROJECT_DIR}/db/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m dbtools.migrations.runner "$@"