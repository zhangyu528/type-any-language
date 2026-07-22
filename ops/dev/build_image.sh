#!/bin/bash
#
# dev/build_image.sh — build backend + frontend images locally for dev.
#
# Use this when DOCKER_REGISTRY isn't configured (offline / first-time local
# setup). Equivalent to:
#
#   docker compose -f docker-compose.dev.yml build
#
# Builds:  english_backend_dev, english_frontend_dev   (matches the image
#         names docker-compose.dev.yml declares and dev/lifecycle.sh checks.)
# Dockerfiles used: backend/Dockerfile.dev, frontend/Dockerfile.dev.
#
# When DOCKER_REGISTRY IS configured, you don't need this script — dev/
# setup.sh does the one-time bootstrap pull from the registry; subsequent
# rebuilds use this script.
#
# The runtime database is TencentDB — no db image is built or required here.
# The backend's DATABASE_URL is sourced at runtime from a host-side
# .secrets/database_url file (mounted via compose's `secrets:` block +
# DATABASE_URL_FILE), written by db/scripts/bootstrap_tencent.sh via
# ops/dev/setup.sh bootstrap.
#
# After build, run:  ./ops/dev/lifecycle.sh start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../../ops/lib.sh"

require_docker

# BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG default to the backend / frontend
# segments' per-stream VERSION files (one file per segment, no dev/prod
# split — gates both the dev and prod image tags). They're exported so
# docker-compose's ${BACKEND_IMAGE_TAG:-latest} / ${FRONTEND_IMAGE_TAG:-latest}
# interpolation in the compose file resolves correctly.
resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
warn_if_version_default "$BACKEND_IMAGE_TAG" backend/VERSION

COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

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
info "  → 启动: ./ops/dev/lifecycle.sh start"