#!/bin/sh
# db/image-entrypoint.sh — custom entrypoint for the prod db image.
#
# Wraps the standard postgres docker-entrypoint.sh to run schema
# migrations and import CMS content BEFORE bringing postgres to the
# foreground. Idempotent: safe to run on every container start
# (migrations.runner stamps applied versions; importer is UPSERT).
#
# Postgres lifecycle (this script):
#   1. Start postgres as a background process
#   2. Wait for pg_isready
#   3. Apply pending migrations (PYTHONPATH=/app)
#   4. Import content (PYTHONPATH=/app, importer reads /app/cms_content/)
#   5. Bring postgres to foreground (wait — postgres becomes PID 1)
#
# Environment variables come from compose's environment: block:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
# We assemble DATABASE_URL from these so migrations + importer can
# reach the in-container postgres (no network — same namespace).

set -e

echo "[db-init] starting postgres in background..."
/usr/local/bin/docker-entrypoint.sh "$@" &
PG_PID=$!

echo "[db-init] waiting for postgres to be ready..."
# Loop up to 30s; postgres normally boots in <5s on a warm image.
ready=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 \
         16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then
    echo "[db-init] ERROR: postgres not ready after 30s" >&2
    kill $PG_PID 2>/dev/null || true
    exit 1
fi

# Build DATABASE_URL for in-container access (no network — same pod).
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export DATABASE_URL

echo "[db-init] applying schema migrations..."
cd /app
python3 -c "from migrations.runner import main; main()"

echo "[db-init] importing CMS content..."
# importer's module path is /app/importer.py; sys.argv is hijacked
# so it sees `importer all` (the typical CLI invocation).
python3 -c "
import sys
sys.argv = ['importer', 'all']
from importer import main
main()
"

echo "[db-init] done. postgres is now the main process."
# Hand off: wait for postgres to exit (becomes PID 1 from the kernel's
# perspective; the entrypoint shell that originally started us has
# already exited via exec — actually we still have the wrapper.
# `wait` is correct here: keeps our PID 1 = postgres, with our shell
# reaped at the end of postgres's life.
wait $PG_PID