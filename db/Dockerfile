# Content-baked db image for type-any-language.
#
# ─── Build pipeline (driven by ./scripts/ops/cms/bake_image.sh) ───────────────
#   1. cms/tools/cms/export_bundle.py dumps content tables into
#      .bake-staging/data-bundle-v.../dump.sql
#   2. bake_image.sh stages that into this directory:
#        .bake-staging/.../dump.sql  →  db/init/01-content.sql
#   3. `docker build` (this file) bakes the SQL in with OCI labels.
#
# ─── Runtime behaviour ────────────────────────────────────────────────────
# On first start of a container from this image, postgres runs every script
# in /docker-entrypoint-initdb.d/ in lexicographic order:
#   01-content.sql    schema + content (from pg_dump)
#
# On subsequent starts postgres skips /docker-entrypoint-initdb.d/ because
# the data dir already exists. That's the intended design: the db data
# volume persists across `docker compose down`/up cycles, and `down -v`
# wipes the db data (re-triggering first init on next `up`).
#
# ─── Audio is NOT baked into this image ────────────────────────────────────
# MP3s are uploaded to Tencent Cloud COS by cms/tools/cms/generate_audio.py
# at bake time, and the `sentences.audio_url` column stores the full COS URL.
# The backend serves `sentence.audio_url` directly to the frontend, which
# streams audio from COS in the browser. This keeps the db image small
# (schema + content tables only — no binary blobs) and lets audio be updated
# without re-baking the db image.
#
# ─── Labels consumed by run.sh ────────────────────────────────────────────
#   type-any-language.db.user             → DB_USER  (compose env)
#   type-any-language.db.name             → DB_NAME  (compose env)
#   type-any-language.content.version     → shown in `docker inspect`
#   type-any-language.content.baked-at    → shown in `docker inspect`
#
# bake_image.sh passes these via `--build-arg` and re-asserts them as
# `docker build --label` (build-arg + LABEL is belt-and-braces — LABEL is
# what actually surfaces in `docker inspect`).

FROM postgres:15-alpine

ARG DB_USER=english_user
ARG DB_NAME=english_learning
ARG CONTENT_VERSION=latest
ARG BAKED_AT=unknown
# Project code version (root ./VERSION, resolved by scripts/lib.sh).
# Same value as CONTENT_VERSION today, but conceptually distinct:
# APP_VERSION is the project semver, CONTENT_VERSION is the content
# snapshot identifier (currently derived from the same VERSION file).
ARG APP_VERSION=latest
ARG GIT_SHA=unknown

# OCI labels — these are the source of truth (docker build --label in
# bake_image.sh re-asserts them, but declaring here keeps `docker build .`
# standalone calls working too).
LABEL type-any-language.role="content-baked-db"
LABEL type-any-language.db.user="${DB_USER}"
LABEL type-any-language.db.name="${DB_NAME}"
LABEL type-any-language.content.version="${CONTENT_VERSION}"
LABEL type-any-language.content.baked-at="${BAKED_AT}"
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

# Init SQL: 01-content.sql is populated by bake_image.sh (gitignored,
# not in repo). That's the only init script — there is no audio to seed.
COPY init/01-content.sql /docker-entrypoint-initdb.d/01-content.sql

# Use the standard postgres:15-alpine entrypoint (no wrapper needed —
# there is no /audio volume to chown anymore). The base image's
# ENTRYPOINT is already /usr/local/bin/docker-entrypoint.sh; we just
# need to re-declare CMD so the standard entrypoint's
# `if [ "$1" = 'postgres' ]` branch runs.
#
# IMPORTANT: leaving CMD unset would silently exit 0 (the entrypoint
# checks $1, falls through to `exec "$@"` with $1="" when no CMD is
# passed).
CMD ["postgres"]