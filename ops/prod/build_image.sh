#!/bin/bash
#
# prod/build_image.sh — build backend + frontend images locally for prod.
#
# Use this when DOCKER_REGISTRY isn't configured (offline / first-time local
# setup on the prod host itself, no separate build pipeline). Equivalent to:
#
#   docker compose build
#
# Builds:  english_backend, english_frontend   (matches the image names
#         docker-compose.yml declares and prod/lifecycle.sh checks.)
# Dockerfiles used: backend/Dockerfile, frontend/Dockerfile.
#
# When DOCKER_REGISTRY IS configured, you don't need this script —
# prod/lifecycle.sh start auto-pulls the pre-built images (built
# elsewhere, e.g. by CI).
#
# The runtime database is TencentDB — no db image is built or required here.
# The backend's DATABASE_URL is sourced at runtime from a host-side
# .secrets/database_url file (mounted via compose's `secrets:` block +
# DATABASE_URL_FILE), written by db/scripts/bootstrap_tencent.sh via
# ops/prod/setup.sh bootstrap.
#
# After build, run:  ./ops/prod/lifecycle.sh start

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
echo ""

"$DOCKER_COMPOSE_CMD" -f "$COMPOSE_FILE" build

echo ""
ok "Build done."
info "  → 检查: docker image inspect $BACKEND_IMAGE"
info "  → 启动: ./ops/prod/lifecycle.sh start"