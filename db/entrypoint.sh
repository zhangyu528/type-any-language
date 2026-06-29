#!/bin/bash
#
# entrypoint.sh — wrapper for the standard postgres entrypoint.
#
# Why this exists:
# The compose file mounts the `shared-audio` Docker named volume at /audio.
# Docker creates named volumes owned by root:root with mode 755 by default.
# Postgres init scripts (in /docker-entrypoint-initdb.d/) run as the
# `postgres` user, so 99-audio.sh can't `cp` into /audio — it gets
# "Permission denied".
#
# The fix: this wrapper runs as root (the container's initial user) and
# chowns the /audio mount point to postgres:postgres before exec'ing
# the standard postgres entrypoint. Once the wrapper execs, the standard
# entrypoint does its usual root → postgres switch via `gosu`, and
# 99-audio.sh (running as postgres) can write to /audio.
#
# Idempotent: re-chowning a dir postgres already owns is a no-op.
#
set -e

# /audio is mounted from the shared-audio volume. Fix perms so the
# postgres user (running 99-audio.sh) can write into it.
if [ -d /audio ]; then
    chown -R postgres:postgres /audio
    chmod 755 /audio
fi

# Hand off to the standard postgres entrypoint. $@ is whatever CMD was
# passed (typically `postgres`). This preserves all of postgres:15-alpine's
# standard init / signal / healthcheck behaviour.
exec /usr/local/bin/docker-entrypoint.sh "$@"
