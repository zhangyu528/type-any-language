#!/bin/sh
#
# backend/entrypoint.sh — placeholder pre-start hook.
#
# backend/Dockerfile.dev installs pip deps at IMAGE BUILD time (matching
# backend/Dockerfile, the prod image). Previously this script ran a
# hash-aware pip install at container start so dependency edits didn't
# require an image rebuild, but that approach needed named docker
# volumes for site-packages + bin to survive container recreates, and
# the volume-masking of the image's existing pip install created a
# chicken-and-egg with the hash gate (first start: hash says "skip"
# but no uvicorn yet → not found). Reverted to install-at-build-time
# for simplicity and reliability.
#
# If/when we want to bring back runtime pip install, this is the place
# to wire it — frontend/entrypoint.sh still does hash-aware npm install
# because anonymous volumes for node_modules survive recreates correctly.

exec "$@"