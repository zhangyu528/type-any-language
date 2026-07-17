#!/bin/sh
#
# backend/entrypoint.sh — hash-aware pip install + exec CMD.
#
# Pattern mirrors frontend/entrypoint.sh (the dev image for the
# frontend dropped `RUN npm ci` and moved dep install to runtime;
# this script does the same for Python). See backend/Dockerfile.dev
# top-of-file comment for the full design rationale ("No `RUN pip
# install`").
#
# Why install at runtime, not at image build time:
#
#   - image size: site-packages for fastapi/uvicorn/sqlalchemy/
#     psycopg2-binary/pydantic/pydantic-settings/cmudict is ~50 MB.
#     Baking it in doubles the dev image and forces a re-download on
#     every rebuild even when only .py code changed.
#   - build speed: skipping pip install at build saves ~30-90s.
#   - The frontend dev image already proved this pattern works (npm
#     install runs in entrypoint.sh, with cold-start overhead traded
#     for image-size + build-speed wins). Backend follows the same
#     pattern for consistency.
#
# Gates (double-check, like the frontend):
#
#   - gate 1 (requirements changed): SHA256 of requirements.txt
#     doesn't match the stored hash → reinstall. Hash file lives in
#     /tmp (NOT /app) so the bind mount (./backend → /app) doesn't
#     either pollute the host working tree or get clobbered by host
#     source edits. /tmp survives `docker restart` (skip pip on warm
#     start) but is wiped by `docker compose down` / recreate (force
#     reinstall on cold start) — exactly the semantics we want.
#   - gate 2 (deps wiped): site-packages marker (the importable
#     `fastapi` module) absent → reinstall regardless of hash.
#     Catches the case where the hash file got carried over from a
#     prior install but the actual wheel store is gone (e.g. manual
#     cleanup, partial volume mount failure).
#
# Hot-reload note: uvicorn --reload (set in Dockerfile.dev's CMD
# and docker-compose.dev.yml's command:) auto-restarts on .py
# changes. requirements.txt changes still need a manual restart
# (uvicorn doesn't watch requirements) — that's intended; a fresh
# pip install needs a fresh process anyway.

set -e

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

exec "$@"