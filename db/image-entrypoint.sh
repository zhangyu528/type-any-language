#!/bin/sh
# db/image-entrypoint.sh — custom entrypoint for the prod db image.
#
# Wraps the standard postgres docker-entrypoint.sh to import CMS content
# BEFORE bringing postgres to the foreground. Idempotent: importer is
# UPSERT, safe to run on every container start.
#
# Schema migrations are NOT applied here. They run in the BACKEND
# container's entrypoint (backend/image-entrypoint.sh runs
# `python3 -m migrations.runner` on boot) — the same "service applies
# its own migrations" idiom. This db entrypoint only imports CMS
# content. The db image is a passive store; the backend owns the
# schema lifecycle.
#
# Postgres lifecycle (this script):
#   1. Start postgres as a background process
#   2. Wait for pg_isready
#   3. Import CMS content (PYTHONPATH=/app, importer reads /app/cms_content/)
#   4. Bring postgres to foreground (wait — postgres becomes PID 1)
#
# Environment variables come from compose's environment: block:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
# We assemble DATABASE_URL from these so the importer can reach the
# in-container postgres (no network — same namespace).

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

echo "[db-init] importing CMS content..."
# importer's module path is /app/importer.py; sys.argv is hijacked
# so it sees `importer all` (the typical CLI invocation).
cd /app
python3 -c "
import sys
sys.argv = ['importer', 'all']
from importer import main
main()
"

echo "[db-init] done. postgres is now the main process."
# wait for postgres to exit (postgres is PID 1 from the kernel's
# perspective; this wrapper gets reaped at the end of postgres's life).
wait $PG_PID