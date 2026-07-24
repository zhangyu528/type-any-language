#!/bin/bash
#
# dev/build_image.sh — build backend + frontend images locally for dev.
#
# Image tag scheme:
#   - **dev image tag** (this script) is derived from current image
#     CONTENT, NOT git state:
#       c<content-hash7>[-dirty]
#     Each segment (backend/frontend) computes its own hash from the
#     inputs that actually affect its image layers — see
#     ops/lib.sh::_dev_image_inputs for the canonical list.
#     Examples:  english_backend_dev:cafefb1e
#               english_backend_dev:cafefb1e-dirty   (local edit to a content input)
#               english_frontend_dev:cd8c1af0        (independent hash, may differ)
#   - **prod image tag** (ops/prod/build_image.sh) is still the semver
#     from backend/VERSION / frontend/VERSION. Dev and prod have
#     different tag sources by design — see the Version resolution
#     comment in ops/lib.sh.
#
# Why content-hash tags for dev:
#   - docs-only commits → image unchanged → tag unchanged ✓
#   - app/*.py edits (bind-mounted, not baked) → image unchanged → tag unchanged ✓
#   - Dockerfile.dev / entrypoint.sh edits → image layers change → tag changes ✓
#   - Two builds at the same content but different commits → same tag ✓
#   - `docker image ls` doesn't accumulate phantom tags from git-only churn.
#
# Why "never pushed to a registry":
#   dev image is local-only. `release.sh dev` (if called) builds + tags
#   but skips the registry push. Only `release.sh prod` pushes.
#
# The runtime database is docker postgres (postgres:15-alpine running
# in the same compose stack as backend + frontend). No db image is
# built by this script. Backend's DATABASE_URL is wired by
# docker-compose.dev.yml's `db` service environment block.
#
# After build, run:  ./ops/dev/lifecycle.sh start
#
# Override the content-derived tag via env var if needed (CI / tests):
#   IMAGE_DEV_TAG=my-test    ./ops/dev/build_image.sh   # both images
#   BACKEND_DEV_TAG=my-test  ./ops/dev/build_image.sh   # backend only
#   FRONTEND_DEV_TAG=my-test ./ops/dev/build_image.sh   # frontend only
# Overrides are used verbatim, including any `-dirty` suffix — caller
# is responsible.

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

# Resolve backend tag. Precedence: BACKEND_DEV_TAG > IMAGE_DEV_TAG > computed hash.
if [ -n "${BACKEND_DEV_TAG:-}" ]; then
    BACKEND_IMAGE_TAG="$BACKEND_DEV_TAG"
    BACKEND_TAG_SRC="BACKEND_DEV_TAG override"
elif [ -n "${IMAGE_DEV_TAG:-}" ]; then
    BACKEND_IMAGE_TAG="$IMAGE_DEV_TAG"
    BACKEND_TAG_SRC="IMAGE_DEV_TAG override"
else
    BACKEND_IMAGE_TAG="$(compute_dev_image_tag backend)"
    BACKEND_TAG_SRC="computed content-hash"
fi

# Resolve frontend tag. Precedence: FRONTEND_DEV_TAG > IMAGE_DEV_TAG > computed hash.
if [ -n "${FRONTEND_DEV_TAG:-}" ]; then
    FRONTEND_IMAGE_TAG="$FRONTEND_DEV_TAG"
    FRONTEND_TAG_SRC="FRONTEND_DEV_TAG override"
elif [ -n "${IMAGE_DEV_TAG:-}" ]; then
    FRONTEND_IMAGE_TAG="$IMAGE_DEV_TAG"
    FRONTEND_TAG_SRC="IMAGE_DEV_TAG override"
else
    FRONTEND_IMAGE_TAG="$(compute_dev_image_tag frontend)"
    FRONTEND_TAG_SRC="computed content-hash"
fi

# Compose's ${BACKEND_IMAGE_TAG:-latest} / ${FRONTEND_IMAGE_TAG:-latest}
# falls back to "latest" if env vars are unset; we always set them so
# the build is reproducible. backend + frontend get INDEPENDENT tags
# (may differ if their content inputs differ).
export BACKEND_IMAGE_TAG
export FRONTEND_IMAGE_TAG

# GIT_SHA surfaces in the image LABEL (visible via `docker inspect`) as
# an informational hint — "what commit produced this image". It's NOT
# the canonical tag anymore (that's BACKEND_IMAGE_TAG). Useful for
# answering "is this image from before or after I rebased?".
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export GIT_SHA

echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo -e "${_LIB_BLUE} type-any-language · dev build${_LIB_BLUE}"
echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo ""
info "dev image tags (from $BACKEND_TAG_SRC / $FRONTEND_TAG_SRC):"
info "  backend:  $BACKEND_IMAGE_TAG"
info "  frontend: $FRONTEND_IMAGE_TAG"
info "  (informational) git HEAD: $GIT_SHA"
echo ""

"$DOCKER_COMPOSE_CMD" -f "$COMPOSE_FILE" build

echo ""
ok "Build done."
info "  → 验证: docker images english_backend_dev english_frontend_dev"
info "  → 启动: ./ops/dev/lifecycle.sh start"