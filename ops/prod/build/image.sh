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
# The runtime database is the postgres:15-alpine container declared
# in docker-compose.yml's `db` service — no separate db image is built
# here. The db password is sourced at runtime from a host-side
# .secrets/db_password file (mounted via compose's `secrets:` block +
# POSTGRES_PASSWORD_FILE in the db service). bootstrap.sh applies the
# schema migrations and imports CMS content on first-time bring-up.
#
# After build, run:  ./ops/prod/lifecycle.sh start
#                   (or first-time: ./ops/prod/deploy.sh)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use git rev-parse to find the actual repo root, not SCRIPT_DIR/../..
# (which breaks on GH Actions due to the double-nested checkout path
# /home/runner/work/<repo>/<repo>/).
PROJECT_DIR="$(git rev-parse --show-toplevel)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

require_docker

# DB_IMAGE_TAG / BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG default to the
# corresponding per-stream VERSION files (one file per segment, no
# dev/prod split — gates both the dev and prod image tags). They're
# exported so docker-compose's ${DB_IMAGE_TAG:-latest} /
# ${BACKEND_IMAGE_TAG:-latest} / ${FRONTEND_IMAGE_TAG:-latest}
# interpolation in the compose file resolves correctly.
resolve_image_tag DB_IMAGE_TAG       db/VERSION
resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
warn_if_version_default "$DB_IMAGE_TAG" db/VERSION

COMPOSE_FILE="docker-compose.yml"
DB_IMAGE="english_db"
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
info "Building $DB_IMAGE + $BACKEND_IMAGE + $FRONTEND_IMAGE via $COMPOSE_FILE"
echo ""

# Note: don't quote $DOCKER_COMPOSE_CMD — it can be "docker-compose" or
# "docker compose" (v2 plugin). Quoting would make bash look for a single
# command literally named "docker compose" (with space) which doesn't exist.
# Without quotes, bash word-splits and runs `docker` with `compose` as
# its first arg, which is what the v2 plugin syntax requires.
$DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" build

# push.sh (called next by release.sh) expects BARE-named local images
# (english_db:v0.1.0) so it can tag bare→remote and push. But `docker
# compose build` tags per the compose `image:` field, which is
# registry-prefixed when DOCKER_REGISTRY is set (e.g.
# ghcr.io/.../english_db:v0.1.0). Create a bare alias so push.sh's
# checks + re-tag work regardless of whether DOCKER_REGISTRY was set
# during the build. When DOCKER_REGISTRY is empty the build already
# produced a bare tag, so this is a no-op.
for pair in "english_db:$DB_IMAGE_TAG" "english_backend:$BACKEND_IMAGE_TAG" "english_frontend:$FRONTEND_IMAGE_TAG"; do
    name="${pair%%:*}"; tag="${pair##*:}"
    src="${DOCKER_REGISTRY:+$DOCKER_REGISTRY/}$name:$tag"
    if [ "$src" != "$name:$tag" ] && image_exists "$src"; then
        docker tag "$src" "$name:$tag"
    fi
done

echo ""
ok "Build done."
info "后续步骤(手动, CI 不会自动执行):"
info "  · 检查镜像: docker image inspect $BACKEND_IMAGE"
info "  · 本地启动: ./ops/prod/lifecycle.sh start   (真正上线由 deploy-prod 负责)"