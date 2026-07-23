#!/bin/sh
#
# backend/entrypoint.sh — hash-aware pip install + apply migrations + exec CMD.
#
# Two responsibilities, in order:
#   1. Install Python deps if needed (hash-aware; matches frontend/entrypoint.sh
#      pattern, see backend/Dockerfile.dev "No `RUN pip install`" comment for
#      the full rationale).
#   2. Apply pending schema migrations to the connected cloud db BEFORE
#      serving traffic. Idempotent — re-runs are no-ops (runner skips
#      already-applied versions in schema_migrations). On every container
#      start, the migrations from the baked-in working tree are applied.
#
# Why migrate at entrypoint time (not via a separate CI step):
#   The migrations/ directory is in the same image as the backend code,
#   so the "what migrations exist" view is identical to "what backend
#   code is running". Running migrations on every container start
#   eliminates the "code ≠ db" drift window: any new migration in the
#   image is applied before the first request, regardless of who pulled
#   the image, when, or what order.
#
# Note on bind mounts (dev mode):
#   docker-compose.dev.yml mounts ./backend → /app, so the working tree
#   in the container is the host's checkout. When the host's
#   backend/migrations/versions/ gets a new file, the next uvicorn
#   hot-reload restart does NOT re-run entrypoint (uvicorn reload ≠
#   container restart). To apply a fresh migration, restart the
#   container: ./ops/dev/lifecycle.sh restart. This is the same
#   pattern as requirements.txt changes.
#
# Idempotency: migration 0001 (the baseline) creates tables via
# `Base.metadata.create_all()` indirectly — it imports backend models.
# create_all() uses CREATE TABLE IF NOT EXISTS, so it's safe to call
# repeatedly.

set -e

# --- 1. pip install (hash-aware) -------------------------------------------
HASH_FILE="/tmp/.requirements.sha256"
CUR_HASH="$(
  {
    [ -f requirements.txt ] && sha256sum requirements.txt
  } | sha256sum | awk '{print $1}'
)"
STORED_HASH="$(cat "$HASH_FILE" 2>/dev/null || echo '')"

NEEDS_INSTALL=0
if [ "$CUR_HASH" != "$STORED_HASH" ]; then
  echo "[entrypoint] requirements.txt changed (was=${STORED_HASH:-none}, now=$CUR_HASH) → pip install"
  NEEDS_INSTALL=1
elif ! python -c "import fastapi" 2>/dev/null; then
  echo "[entrypoint] hash matches but fastapi not importable (deps wiped?) → pip install"
  NEEDS_INSTALL=1
else
  echo "[entrypoint] requirements.txt unchanged (hash=$CUR_HASH) and deps importable → skip pip install"
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
  if [ ! -f requirements.txt ]; then
    echo "[entrypoint] requirements.txt missing — nothing to install" >&2
  else
    pip install --no-cache-dir -r requirements.txt
    echo "$CUR_HASH" > "$HASH_FILE"
  fi
fi

# --- 2. Apply pending schema migrations ------------------------------------
# Idempotent: runner reads schema_migrations table and skips already-applied
# versions. If DATABASE_URL is unset (e.g. local test run), skip with a
# warning rather than failing the container — uvicorn can still serve and
# tests can still import; only DB-touching requests would 500.
if [ -n "${DATABASE_URL:-}" ] || [ -n "${DATABASE_URL_FILE:-}" ]; then
  echo "[entrypoint] applying pending schema migrations..."
  # migrations/ package lives at /app/migrations (copied by Dockerfile /
  # mounted by docker-compose.dev.yml). backend/init_schema.py imports
  # migrations + db_url — backend/ is on PYTHONPATH via WORKDIR
  # /app, db/ would need to be added for the defensive db_url fallback.
  # In normal operation DATABASE_URL is already exported by the
  # container's env block (compose) or by the secrets mount path
  # (DATABASE_URL_FILE → /run/secrets/database_url → backend reads it
  # via config.py's _apply_file_indirection, but here we need a
  # plain env var for the migration runner to read).
  if [ -n "${DATABASE_URL_FILE:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
    if [ -f "${DATABASE_URL_FILE}" ]; then
      export DATABASE_URL="$(cat "${DATABASE_URL_FILE}")"
      echo "[entrypoint] DATABASE_URL loaded from ${DATABASE_URL_FILE}"
    fi
  fi
  python -m migrations.runner && echo "[entrypoint] migrations applied" || {
    echo "[entrypoint] MIGRATION FAILED — refusing to start uvicorn" >&2
    echo "[entrypoint] Fix the failing migration and re-deploy." >&2
    exit 1
  }
else
  echo "[entrypoint] DATABASE_URL unset — skipping migrations (local/test mode)"
fi

# --- 3. exec CMD -----------------------------------------------------------
exec "$@"