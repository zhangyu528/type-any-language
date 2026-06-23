#!/bin/bash
#
# prod-host/build_image.sh — build backend + frontend images locally for prod.
#
# Use this when DOCKER_REGISTRY isn't configured (offline / first-time local
# setup on the prod host itself, no separate build pipeline). Equivalent to:
#
#   docker compose build
#
# Builds:  english_backend, english_frontend   (matches the image names
#         docker-compose.yml declares and prod-host/run.sh checks.)
# Dockerfiles used: backend/Dockerfile, frontend/Dockerfile.
#
# When DOCKER_REGISTRY IS configured, you don't need this script —
# prod-host/run.sh start will `docker pull` the pre-built images (built
# elsewhere, e.g. by CI). The db image is NEVER built here — it must be
# baked by the CMS host via scripts/ops/db/bake_image.sh and pushed to
# the registry.
#
# After build, run:  ./scripts/ops/prod-host/run.sh start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../../lib.sh"

require_docker

# BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG default to VERSION.prod (the prod
# stream's tag). They're exported so docker-compose's
# ${BACKEND_IMAGE_TAG:-latest} / ${FRONTEND_IMAGE_TAG:-latest}
# interpolation in the compose file resolves correctly.
resolve_image_tag BACKEND_IMAGE_TAG VERSION.prod
resolve_image_tag FRONTEND_IMAGE_TAG VERSION.prod
warn_if_version_default "$BACKEND_IMAGE_TAG" VERSION.prod

COMPOSE_FILE="docker-compose.yml"
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"

# Best-effort short git SHA. Falls back to "unknown" if the build context
# isn't a git checkout. Exported so compose's `args: GIT_SHA` block picks
# it up — surfaces in the image as type-any-language.app.git-sha.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export GIT_SHA

echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo -e "${_LIB_BLUE} type-any-language · prod build${_LIB_BLUE}"
echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo ""
info "Building $BACKEND_IMAGE + $FRONTEND_IMAGE via $COMPOSE_FILE"
info "(db image is NOT built here — CMS host scripts/ops/db/bake_image.sh does that)"
echo ""

"$DOCKER_COMPOSE_CMD" -f "$COMPOSE_FILE" build

echo ""
ok "Build done."
info "  → 检查: docker image inspect $BACKEND_IMAGE"
info "  → 启动: ./scripts/ops/prod-host/run.sh start"