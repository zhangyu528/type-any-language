#!/bin/bash
#
# 99-audio.sh — seed the shared-audio volume with baked MP3s.
#
# Runs once, on first DB initialisation. Postgres skips
# /docker-entrypoint-initdb.d/ on subsequent starts because the data dir
# already exists; the shared-audio volume persists across those restarts,
# so we don't need to re-seed. `docker compose down -v` wipes both the db
# data AND the audio volume together, so the next `up` re-runs this and
# the DB schema in lockstep.
#
# Source:      /seed/audio/        ← baked into image at build time
# Destination: /audio/             ← bind mount of shared-audio volume
#                                  ← mounted by docker-compose.yml
#
# Idempotent on re-run (cp is overwrite, not error-on-exist). Belt-and-
# braces against any path where someone manually re-runs the entrypoint
# without wiping the volume.
set -e

if [ ! -d /seed/audio ]; then
    echo "[99-audio] /seed/audio not present in image — nothing to seed"
    exit 0
fi

mkdir -p /audio

count=0
# Use a for-loop over the glob so an empty /seed/audio doesn't blow up
# (the bare `cp /seed/audio/* /audio/` would error on empty glob).
for f in /seed/audio/*; do
    [ -e "$f" ] || continue
    cp "$f" /audio/
    count=$((count + 1))
done

if [ "$count" -gt 0 ]; then
    echo "[99-audio] seeded $count audio file(s) into /audio"
else
    echo "[99-audio] /seed/audio is empty — nothing to seed"
fi