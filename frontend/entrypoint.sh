#!/bin/sh
#
# frontend/entrypoint.sh — hash-aware npm install + exec CMD.
#
# Pattern mirrors backend/entrypoint.sh. The frontend dev image
# pre-installs deps at build time (npm ci) and bakes source as a
# baseline. Compose watch's `develop.watch` rules in
# docker-compose.dev.yml sync src/, public/, package*.json, and config
# files into /app at runtime, so:
#
#   - Cold start (no recorded hash, node_modules empty):
#       hash missing → npm install, record hash. Takes 10s–1min.
#   - Warm start (deps already baked in image + hash file exists):
#       hash matches + node_modules/.package-lock.json present → skip.
#       `next dev` starts in ~1s.
#   - Edit package.json / package-lock.json (synced in by compose watch):
#       hash mismatch → npm install against the synced files.
#       No image rebuild required — `run.sh restart` is enough.
#
# Container recreate wipes /app/.package-lock.sha256 (it lives in the
# container filesystem, not in a named volume) AND wipes node_modules
# (also in container filesystem — there's no node_modules named volume
# anymore under the compose-watch layout). The hash file gets rewritten
# on every install, and node_modules/.package-lock.json gates a missing
# install even when the hash file got re-baked from image and matches
# by coincidence. Belt + suspenders.

set -e

HASH_FILE="/app/.package-lock.sha256"
# Hash both files so editing either triggers a reinstall. Use a stable
# delimiter; cat's exit code on missing files is fine because we
# explicitly check for package-lock.json below.
CUR_HASH="$(
  {
    [ -f package.json ] && sha256sum package.json
    [ -f package-lock.json ] && sha256sum package-lock.json
  } | sha256sum | awk '{print $1}'
)"
STORED_HASH="$(cat "$HASH_FILE" 2>/dev/null || echo '')"

# node_modules gate: even if the lockfile hash matches (no package change),
# a wiped node_modules means deps aren't actually installed. npm writes
# node_modules/.package-lock.json as a sync marker; its absence = needs
# install regardless of hash. Under the compose-watch layout, container
# recreate wipes node_modules entirely (no named volume protects it
# anymore), so this gate is what saves cold starts from claiming the
# install is up to date.
NEEDS_INSTALL=0
if [ "$CUR_HASH" != "$STORED_HASH" ]; then
  echo "[entrypoint] package.json/package-lock.json changed (was=${STORED_HASH:-none}, now=$CUR_HASH) → npm install"
  NEEDS_INSTALL=1
elif [ ! -f node_modules/.package-lock.json ]; then
  echo "[entrypoint] hash matches but node_modules/.package-lock.json missing (deps wiped?) → npm install"
  NEEDS_INSTALL=1
else
  echo "[entrypoint] package files unchanged (hash=$CUR_HASH) → skip npm install"
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
  echo "$CUR_HASH" > "$HASH_FILE"
fi

exec "$@"
