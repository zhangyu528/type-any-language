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

# Assemble DATABASE_URL from the mounted secret. docker-compose's
# `environment:` block doesn't run a shell, so we can't inline
# `$(cat /run/secrets/db_password)` there — the literal string
# would land in the env, and psycopg2 would choke parsing it
# (saw this on the first deploy: `invalid integer value "$(cat "
# for connection option "port"`). Doing it here keeps the secret
# out of any docker inspect / compose dump.
if [ -z "${DATABASE_URL:-}" ]; then
    if [ ! -s /run/secrets/db_password ]; then
        echo "[backend-init] ERROR: /run/secrets/db_password missing or empty" >&2
        exit 1
    fi
    DB_PASSWORD="$(cat /run/secrets/db_password)"
    export DATABASE_URL="postgresql://english_prod:${DB_PASSWORD}@db:5432/english_prod"
fi

echo "[backend-init] applying schema migrations..."
cd /app
python3 -m migrations.runner

echo "[backend-init] migrations done — starting uvicorn."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000