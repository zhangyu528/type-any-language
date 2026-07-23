#!/bin/bash
#
# dev/build_image.sh — build backend + frontend images locally for dev.
#
# Image tag scheme:
#   - **dev image tag** (this script) is derived from current git state:
#       <sanitized-branch>-<short-sha>[-dirty]
#     Examples:  english_backend_dev:master-abc1234
#               english_backend_dev:feat_sentence_links-abc1234
#               english_backend_dev:feat_x-abc1234-dirty
#   - **prod image tag** (ops/prod/build_image.sh) is still the semver
#     from backend/VERSION / frontend/VERSION. Dev and prod have
#     different tag sources by design — see the Version resolution
#     comment in ops/lib.sh.
#
# Why git-state tags for dev:
#   Two builds at different commits produce different image tags →
#   `docker image ls` shows them side by side. No VERSION-file edits
#   needed during dev iteration.
#
# Why "never pushed to a registry":
#   dev image is local-only. `release.sh dev` (if called) builds + tags
#   but skips the registry push. Only `release.sh prod` pushes.
#
# The runtime database is either TencentDB (today, see CLAUDE.md) or
# a docker-compose-managed local postgres (after the docker-db refactor).
# No db image is built by this script either way. Backend's
# DATABASE_URL / DATABASE_URL_FILE is set by ops/dev/setup.sh bootstrap
# / dev/lifecycle.sh start, depending on which db source is active.
#
# After build, run:  ./ops/dev/lifecycle.sh start
#
# Override the git-derived tag via env var if needed (CI / tests):
#   IMAGE_DEV_TAG=my-branch ./ops/dev/build_image.sh
# IMAGE_DEV_TAG will be used as-is, including the optional `-dirty`
# suffix — caller is responsible.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../../ops/lib.sh"

require_docker

COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

# Dev tags come from git, NOT from VERSION files. If IMAGE_DEV_TAG is
# set in env (CI / test override), use it verbatim; otherwise compute
# from current branch + short sha (+ `-dirty` if working tree dirty).
if [ -n "${IMAGE_DEV_TAG:-}" ]; then
    DEV_TAG="$IMAGE_DEV_TAG"
    info "Using IMAGE_DEV_TAG override: $DEV_TAG"
else
    DEV_TAG="$(compute_dev_image_tag)"
fi

# Compose's ${BACKEND_IMAGE_TAG:-X} / ${FRONTEND_IMAGE_TAG:-X} resolves to the
# default `X` if those env vars are unset; but we want to force the same
# dev tag for both backend and frontend (they're scoped to one build),
# so we export BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG explicitly.
export BACKEND_IMAGE_TAG="$DEV_TAG"
export FRONTEND_IMAGE_TAG="$DEV_TAG"

# GIT_SHA still useful for embedding in the image LABEL (visible via
# `docker inspect`). It is informational; the canonical tag is
# BACKEND_IMAGE_TAG above.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export GIT_SHA

echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo -e "${_LIB_BLUE} type-any-language · dev build${_LIB_BLUE}"
echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo ""
info "dev image tag (computed from git state): $DEV_TAG"
info "  branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'detached')"
info "  commit: $GIT_SHA"
echo ""

"$DOCKER_COMPOSE_CMD" -f "$COMPOSE_FILE" build

echo ""
ok "Build done."
info "  → 验证: docker images english_backend_dev english_frontend_dev"
info "  → 启动: ./ops/dev/lifecycle.sh start"