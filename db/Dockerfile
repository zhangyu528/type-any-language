# Content-baked db image for type-any-language.
#
# ─── Build pipeline (driven by ./scripts/ops/db/bake_image.sh) ───────────────
#   1. db/pipeline/export_bundle.py dumps content_items + audio/ into
#      .bake-staging/data-bundle-v.../
#   2. bake_image.sh stages those into this directory:
#        .bake-staging/.../dump.sql  →  db/init/01-content.sql
#        .bake-staging/.../audio/    →  db/seed/audio/
#   3. `docker build` (this file) bakes them in with OCI labels.
#
# ─── Runtime behaviour ────────────────────────────────────────────────────
# On first start of a container from this image, postgres runs every script
# in /docker-entrypoint-initdb.d/ in lexicographic order:
#   01-content.sql    schema + content (from pg_dump)
#   99-audio.sh       copies /seed/audio/*.mp3 → /audio (shared volume)
#
# On subsequent starts postgres skips /docker-entrypoint-initdb.d/ because
# the data dir already exists. That's the intended design: the shared-audio
# volume persists across `docker compose down`/up cycles, and `down -v`
# wipes both the db data and audio together (re-triggering first init).
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

# Init scripts: 01-content.sql is populated by bake_image.sh (gitignored,
# not in repo), 99-audio.sh is committed.
COPY init/01-content.sql /docker-entrypoint-initdb.d/01-content.sql
COPY init/99-audio.sh    /docker-entrypoint-initdb.d/99-audio.sh

# Seed audio: bake_image.sh copies the baked MP3s here before build.
# If the dir is empty (e.g. vocabulary has no audio yet) COPY still
# succeeds — empty src dir creates an empty dest dir.
COPY seed/audio /seed/audio