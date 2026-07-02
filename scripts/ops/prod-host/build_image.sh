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
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
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
# DB_IMAGE_TAG defaults to VERSION.prod (db is "prod-bound" content).
# Resolved here so the DB_FULL_IMAGE we ask for below matches the tag
# the db image was actually baked with — otherwise the "image not found"
# hint would point at `:latest` and mislead.
resolve_image_tag DB_IMAGE_TAG VERSION.prod

COMPOSE_FILE="docker-compose.yml"
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"

# DB_USER / DB_NAME — the compose file's ${DB_USER:?...} / ${DB_NAME:?...}
# require these to be set even at `docker compose build` time (compose
# evaluates the full file). At runtime, run.sh inspect_db_image_labels
# reads them from the db image's OCI labels. We mirror that here, with
# NO fallback: a silent fallback to "english_user / english_learning"
# would build a broken image if the operator ever customized
# POSTGRES_USER / POSTGRES_DB in their bake (build succeeds, runtime
# fails — worst kind of bug). The contract is therefore: the db image
# must be present locally before `build_image.sh` runs.
#   - CMS host:     run scripts/ops/db/bake_image.sh first.
#   - Target host:  `docker pull $DB_FULL_IMAGE` from the registry
#                   (auto-pulled by `run.sh start` when DOCKER_REGISTRY
#                   is set, but build runs before start, so do it once
#                   manually).
#   - Or:           set DB_IMAGE / DB_IMAGE_TAG in the shell to point
#                   at a db image you already have.
DB_IMAGE="${DB_IMAGE:-english_db_content}"
DB_FULL_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG:-latest}"
if ! image_exists "$DB_FULL_IMAGE"; then
    err "db image $DB_FULL_IMAGE 不在本地 — build 必须知道 DB_USER / DB_NAME"
    info "  解决: 跑 scripts/ops/db/bake_image.sh 烤一个(本机有 .env.db 的情况下)"
    info "  或:   docker pull $DB_FULL_IMAGE  (DOCKER_REGISTRY 配了的话)"
    info "  或:   shell 覆盖 DB_IMAGE / DB_IMAGE_TAG 指向已有的 image"
    exit 1
fi
DB_USER="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.user" || echo "")"
DB_NAME="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.name" || echo "")"
if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
    err "db image $DB_FULL_IMAGE 缺 type-any-language.db.user / .db.name label"
    info "  → 重新跑 scripts/ops/db/bake_image.sh 烤一个带 label 的"
    exit 1
fi
export DB_USER DB_NAME

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