#!/usr/bin/env bash
#
# ops/release/build.sh - build + push the 3 prod images (db/backend/frontend)
# to ${DOCKER_REGISTRY}. Called by release-build.yml after the tag has been
# resolved; the workflow's docker/login-action handles GHCR login OUTSIDE
# this script (so re-running this locally requires manual `docker login`).
#
# Required env vars (exported by release-build.yml):
#   NEW_TAG         - the resolved rc tag, e.g. v0.4.0-rc.1
#   DOCKER_REGISTRY - registry namespace, e.g. ghcr.io/<owner>/type-any-language
#   GIT_SHA         - HEAD commit SHA, baked into the image LABEL for drift
#                     detection (ops/cvm/_common.sh::drift_check reads it)
# Optional:
#   NEXT_PUBLIC_API_URL - frontend build arg (default "/", see _common.sh)

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
require_release_env
[ -n "${GIT_SHA:-}" ] || { err "GIT_SHA required (exported by release-build.yml)"; exit 1; }

info "build + push 3 images to ${DOCKER_REGISTRY} (NEW_TAG=${NEW_TAG}, GIT_SHA=${GIT_SHA})"

for img in "${RELEASE_IMAGES[@]}"; do
    full="$(build_image_for "$img" "$NEW_TAG")"
    info "  push ${full}"
    docker push "$full"
done

ok "build + push done (3 images at ${NEW_TAG})"
