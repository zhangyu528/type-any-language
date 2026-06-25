#!/bin/sh
#
# frontend/entrypoint.sh — hash-aware npm install + exec CMD.
#
# Pattern mirrors backend/entrypoint.sh (which does the same for pip).
# Frontend dev image doesn't pre-install deps — this script gates on a
# SHA256 of package.json + package-lock.json so:
#   - Cold start (no recorded hash) → install, record hash.
#   - Subsequent starts with unchanged deps → skip install, start
#     Next.js dev server in ~1s.
#   - Edit package.json / package-lock.json → hash mismatch →
#     reinstall → record new hash. No image rebuild needed; just
#     `./dev.sh restart`.
#
# Hash file lives at /app (bind-mounted to ./frontend), so it persists
# across container recreates. The earlier node_modules-existence check
# missed the case where you add a new dep to package.json but
# node_modules already exists from a previous install.

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
# a wiped node_modules (e.g. anonymous volume lost on `compose down` —
# fixed by using a named volume, but belt + suspenders here) means deps
# aren't actually installed. npm writes node_modules/.package-lock.json
# as a sync marker; its absence = needs install regardless of hash.
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
