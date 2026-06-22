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
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

require_docker

COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

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