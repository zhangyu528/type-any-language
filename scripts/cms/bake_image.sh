#!/bin/bash
#
# cms/bake_image.sh — bake the content into a portable db image.
#
# The image is a postgres:15-alpine wrapper that pre-loads the
# `content_items` table and all audio MP3s. Fresh hosts `docker pull`
# this image and have immediate content without any AI calls.
#
# Image labels baked in (read by prod/dev run.sh via `docker inspect`):
#   type-any-language.db.user           POSTGRES_USER from .env.cms
#   type-any-language.db.name           POSTGRES_DB   from .env.cms
#   type-any-language.content.version   DB_IMAGE_TAG  from .env.cms
#   type-any-language.content.baked-at  <UTC timestamp>
#
# Subcommands:
#   (default)  Bake: export content from DB → stage into cms/db-image/ → docker build
#   doctor     Pre-flight: docker installed? source content present?
#
# Image naming:
#   Local:  ${DB_IMAGE:-english_db_content}:${DB_IMAGE_TAG:-latest}
#   Registry: ${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}
#   All sourced from .env.cms (defaults match docker-compose.yml).
#
# This script does NOT modify content. It only packages whatever is
# currently in the DB + ./audio/. To update content, run
# `scripts/cms/content.sh {sync,sentences,audio,publish}` first.
#
# This script does NOT push. Pushing is a separate, intentional step:
# you might bake many times locally and only push when ready.
# Use ./scripts/cms/push_image.sh for that.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../lib.sh"

# Load .env.cms so $DB_IMAGE / $DB_IMAGE_TAG / $DOCKER_REGISTRY / $DATABASE_URL
# / $POSTGRES_USER / $POSTGRES_DB resolve. Refuses to continue if .env.cms is
# missing — run scripts/cms/env.sh first.
if [ -f .env.cms ]; then
    set -a; . ./.env.cms; set +a
else
    echo "[ERR] .env.cms 不存在 — 跑 ./scripts/cms/env.sh 先引导一份" >&2
    exit 1
fi

DB_IMAGE="${DB_IMAGE:-english_db_content}"
DB_IMAGE_TAG="${DB_IMAGE_TAG:-latest}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"   # empty = local only
FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
REMOTE_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${FULL_IMAGE}"

# Source-of-truth for what's inside the image. These get baked into
# image labels so target hosts can discover them via `docker inspect`.
POSTGRES_USER="${POSTGRES_USER:-english_user}"
POSTGRES_DB="${POSTGRES_DB:-english_learning}"

DB_IMAGE_DIR="cms/db-image"
DATA_PIPELINE_DIR="cms/data_pipeline"
STAGING_DIR=".bake-staging"

# Cross-platform stat for "size in bytes". Linux uses -c%s, macOS uses -f%z.
file_size() {
    stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "Checking environment for bake..."

    if ! check_docker_installed; then
        err "Docker not installed"
        ok=0
    else
        ok "Docker installed"
    fi

    if ! check_docker_daemon_running; then
        err "Docker daemon not running"
        ok=0
    else
        ok "Docker daemon running"
    fi

    if [ ! -d "cms/content" ]; then
        err "cms/content/ directory missing — run ./scripts/cms/env.sh"
        ok=0
    else
        ok "cms/content/ present"
    fi

    if [ ! -f "$DATA_PIPELINE_DIR/export_bundle.py" ]; then
        err "$DATA_PIPELINE_DIR/export_bundle.py missing"
        ok=0
    else
        ok "$DATA_PIPELINE_DIR/ present"
    fi

    # Are we trying to build from an empty DB? That'll produce an empty
    # content_items table, which is fine but probably not what the operator
    # wants. Warn loudly.
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^english_db$"; then
        ok "DB container english_db is running — export will source from it"
    elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^english_db_dev$"; then
        ok "DB container english_db_dev is running — export will source from it"
    else
        warn "No english_db{,_dev} container running. export_bundle will fail"
        warn "  unless local pg_dump can reach POSTGRES_HOST/PORT."
    fi

    if [ "$ok" = "1" ]; then return 0; else return 1; fi
}

# ---------------------------------------------------------------------------
# main: the bake (default action — no subcommand needed)
# ---------------------------------------------------------------------------
cmd_bake() {
    cmd_doctor || exit 1

    # Pick a python interpreter.
    PY="$(py_cmd)"

    echo
    info "Exporting content from current DB (--content-only --no-tar)..."
    rm -rf "$STAGING_DIR"
    mkdir -p "$STAGING_DIR"

    # export_bundle creates a dated subdir; capture its path.
    # cms/ must be on PYTHONPATH so `from data_pipeline.env import setup` resolves.
    if ! PYTHONPATH="cms${PYTHONPATH:+:$PYTHONPATH}" \
         "$PY" "$DATA_PIPELINE_DIR/export_bundle.py" \
            --content-only --no-tar --keep-staging \
            --output-dir "$STAGING_DIR"; then
        err "export_bundle failed"
        rm -rf "$STAGING_DIR"
        exit 1
    fi

    bundle_path="$(ls -td "$STAGING_DIR"/data-bundle-v* 2>/dev/null | head -1)"
    if [ -z "$bundle_path" ] || [ ! -f "$bundle_path/dump.sql" ]; then
        err "Export did not produce dump.sql — see errors above"
        exit 1
    fi

    echo
    info "Staging db-image inputs..."
    mkdir -p "$DB_IMAGE_DIR/init" "$DB_IMAGE_DIR/seed/audio"
    cp "$bundle_path/dump.sql" "$DB_IMAGE_DIR/init/01-content.sql"

    if [ -d "$bundle_path/audio" ]; then
        rm -rf "$DB_IMAGE_DIR/seed/audio"
        mkdir -p "$DB_IMAGE_DIR/seed/audio"
        # Trailing /. copies contents, not the audio/ dir itself.
        cp -r "$bundle_path/audio/." "$DB_IMAGE_DIR/seed/audio/"
        audio_count=$(find "$DB_IMAGE_DIR/seed/audio" -type f 2>/dev/null | wc -l)
        ok "  → ${audio_count} audio file(s)"
    else
        warn "  → no audio dir in bundle (empty vocabulary?)"
    fi

    content_size=$(file_size "$DB_IMAGE_DIR/init/01-content.sql")
    ok "  → 01-content.sql (${content_size} bytes)"

    # Clean staging — db-image/ now owns the inputs.
    rm -rf "$STAGING_DIR"

    # UTC timestamp for the image label.
    baked_at="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"

    echo
    info "Building image: ${FULL_IMAGE}"
    info "  labels: db.user=$POSTGRES_USER  db.name=$POSTGRES_DB  version=$DB_IMAGE_TAG  baked_at=$baked_at"
    docker build \
        --tag "${FULL_IMAGE}" \
        --build-arg "DB_USER=${POSTGRES_USER}" \
        --build-arg "DB_NAME=${POSTGRES_DB}" \
        --build-arg "CONTENT_VERSION=${DB_IMAGE_TAG}" \
        --build-arg "BAKED_AT=${baked_at}" \
        --label "org.opencontainers.image.source=https://github.com/zhangyu528/type-any-language" \
        --label "org.opencontainers.image.created=${baked_at}" \
        --label "type-any-language.role=content-baked-db" \
        --label "type-any-language.db.user=${POSTGRES_USER}" \
        --label "type-any-language.db.name=${POSTGRES_DB}" \
        --label "type-any-language.content.version=${DB_IMAGE_TAG}" \
        --label "type-any-language.content.baked-at=${baked_at}" \
        "${DB_IMAGE_DIR}/"

    echo
    ok "Built: ${FULL_IMAGE}"
    if [ -n "$DOCKER_REGISTRY" ]; then
        echo "  To push: ./scripts/cms/push_image.sh"
    fi
}

usage() {
    cat <<EOF
Usage: $0 [doctor]

  (no args)   Bake: export content from DB → stage into cms/db-image/ → docker build
  doctor      Pre-flight environment check

Push is a separate step: ./scripts/cms/push_image.sh

Environment (sourced from .env.cms):
  DB_IMAGE        Image name (default: english_db_content)
  DB_IMAGE_TAG    Image tag (default: latest) — also baked into image label
  DOCKER_REGISTRY Registry namespace (e.g. docker.io/youruser).
                   If empty, push is disabled (local image only).
  POSTGRES_USER   Baked into image label as type-any-language.db.user
                  (default: english_user). The dump.sql's OWNER must match.
  POSTGRES_DB     Baked into image label as type-any-language.db.name
                  (default: english_learning). The dump.sql's database must match.
EOF
}

case "${1:-}" in
    doctor)     cmd_doctor ;;
    -h|--help|help) usage ;;
    "")         cmd_bake ;;
    *)          usage; err "Unknown subcommand: $1"; exit 1 ;;
esac
