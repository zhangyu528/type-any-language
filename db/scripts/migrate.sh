#!/bin/bash
#
# db/scripts/migrate.sh — apply pending schema migrations to a populated
# source db. Idempotent (runner.py stamps applied versions in
# schema_migrations; re-runs are no-ops).
#
# Why this lives in db/scripts/:
#   Schema migration is a db concern. Like init_schema.sh, this
#   script shells out to CMS Python (`cms.migrations.runner`) because
#   that's where the migration versions live — but the "when to apply
#   migrations" decision belongs to db.
#
# Usage:
#   # 1. Make sure a populated db is reachable.
#   ./db/scripts/source_db.sh ensure
#   # 2. (first time) init schema, then apply migrations.
#   ./db/scripts/init_schema.sh
#   ./db/scripts/migrate.sh
#   # On subsequent runs (after editing cms/tools/cms/migrations/versions/):
#   ./db/scripts/migrate.sh
#
# Idempotent: re-runs are no-ops.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PYTHONPATH="${PROJECT_DIR}/cms/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m cms.migrations.runner "$@"