#!/bin/bash
#
# dev-host/build_image.sh — build backend + frontend images locally for dev.
#
# Use this when DOCKER_REGISTRY isn't configured (offline / first-time local
# setup). Equivalent to:
#
#   docker compose -f docker-compose.dev.yml build
#
# Builds:  english_backend_dev, english_frontend_dev   (matches the image:
#         names docker-compose.dev.yml declares and dev-host/run.sh checks.)
# Dockerfiles used: backend/Dockerfile.dev, frontend/Dockerfile.dev.
#
# When DOCKER_REGISTRY IS configured, you don't need this script — dev-host/
# run.sh start will `docker pull` the pre-built images from the registry.
#
# After build, run:  ./scripts/ops/dev-host/run.sh start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../../lib.sh"

require_docker

# BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG default to VERSION.dev (the dev
# stream's tag). They're exported so docker-compose's
# ${BACKEND_IMAGE_TAG:-latest} / ${FRONTEND_IMAGE_TAG:-latest}
# interpolation in the compose file resolves correctly.
resolve_image_tag BACKEND_IMAGE_TAG VERSION.dev
resolve_image_tag FRONTEND_IMAGE_TAG VERSION.dev
warn_if_version_default "$BACKEND_IMAGE_TAG" VERSION.dev

COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

# DB_USER / DB_NAME — the compose file's ${DB_USER:?...} / ${DB_NAME:?...}
# require these to be set even at `docker compose build` time (compose
# evaluates the full file). At runtime, run.sh inspect_db_image_labels
# reads them from the db image's OCI labels. For build, we mirror that:
# if the db image is available locally, use its labels; otherwise fall
# back to the defaults that scripts/ops/db/bake_image.sh produces.
#   - The dev host may not have the db image at all (the CMS host bakes
#     and pushes it). The defaults keep `release.sh dev` working even
#     when only the build host's registry is involved.
#   - If the operator's db image uses different user/db names, set
#     DB_USER/DB_NAME in the shell when running build, or `docker pull`
#     the db image first so its labels can be read here.
DB_IMAGE="${DB_IMAGE:-english_db_content}"
DB_FULL_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG:-latest}"
if image_exists "$DB_FULL_IMAGE"; then
    DB_USER="$(docker inspect "$DB_FULL_IMAGE" \
        --format '{{ index .Config.Labels "type-any-language.db.user" }}' 2>/dev/null || echo "english_user")"
    DB_NAME="$(docker inspect "$DB_FULL_IMAGE" \
        --format '{{ index .Config.Labels "type-any-language.db.name" }}' 2>/dev/null || echo "english_learning")"
else
    DB_USER="${DB_USER:-english_user}"
    DB_NAME="${DB_NAME:-english_learning}"
    info "db image $DB_FULL_IMAGE 不在本地 — DB_USER/DB_NAME 默认到 english_user/english_learning"
    info "  (如果你的 db image 用了别的 user/db 名, 提前 docker pull 或 shell 覆盖 DB_USER/DB_NAME)"
fi
export DB_USER DB_NAME

# Best-effort short git SHA. Falls back to "unknown" if the build context
# isn't a git checkout (e.g. CI checked out via tarball). Exported so
# compose's `args: GIT_SHA` block picks it up — surfaces in the image as
# type-any-language.app.git-sha.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export GIT_SHA

echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo -e "${_LIB_BLUE} type-any-language · dev build${_LIB_BLUE}"
echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo ""
info "Building $BACKEND_IMAGE + $FRONTEND_IMAGE via $COMPOSE_FILE"
echo ""

"$DOCKER_COMPOSE_CMD" -f "$COMPOSE_FILE" build

echo ""
ok "Build done."
info "  → 检查: docker image inspect $BACKEND_IMAGE"
info "  → 启动: ./scripts/ops/dev-host/run.sh start"