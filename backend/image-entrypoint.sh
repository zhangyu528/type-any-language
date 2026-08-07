#!/bin/sh
# backend/image-entrypoint.sh — backend container entrypoint.
#
# Two-phase startup:
#   1. Apply pending schema migrations against the linked db container.
#      Runs python3 -m migrations.runner; the runner stamps applied
#      versions in schema_migrations so this is idempotent across
#      container restarts. Migrations use the same sqlalchemy +
#      psycopg2-binary already in requirements.txt — no extra deps.
#
#   2. Start uvicorn.
#
# Rationale: putting migrations here (instead of in db's entrypoint
# or in deploy.sh) keeps the schema lifecycle co-located with the
# application that owns the ORM models, and matches the Rails /
# Django "service applies its own migrations on boot" idiom. Dev runs
# the same migrations host-side via ./ops/dev/migrate.sh which calls
# the very same python3 -m migrations.runner.
#
# Environment:
#   DATABASE_URL is composed by docker-compose's environment: block
#   (read from /run/secrets/db_password), so this script doesn't
#   need to assemble it.

set -e

echo "[backend-init] applying schema migrations..."
cd /app
python3 -m migrations.runner

echo "[backend-init] migrations done — starting uvicorn."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000