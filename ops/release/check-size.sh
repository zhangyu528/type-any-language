#!/usr/bin/env bash
#
# ops/release/check-size.sh - fail the release if any image exceeds MAX_IMAGE_BYTES.
#
# Catches accidental image bloat (a stray COPY that pulls in node_modules,
# an .git mounted into the image, etc.) before it ships to prod.
#
# Required env vars (exported by release-build.yml):
#   NEW_TAG         - the resolved rc tag (images must already be present
#                     locally; release-build.yml runs build.sh first)
#   DOCKER_REGISTRY - registry namespace
# Optional:
#   MAX_IMAGE_BYTES - budget in bytes (default 500000000 = 500 MB; set in
#                     _common.sh)

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
require_release_env

info "image size check (budget ${MAX_IMAGE_BYTES} bytes per image)"
fail=0

for img in "${RELEASE_IMAGES[@]}"; do
    full="$(image_full_name "$img" "$NEW_TAG")"
    size="$(docker image inspect "$full" --format "{{.Size}}")"
    if [ "$size" -gt "$MAX_IMAGE_BYTES" ]; then
        err "  ${img}: ${size} bytes > ${MAX_IMAGE_BYTES} (over budget)"
        fail=1
    else
        ok "  ${img}: ${size} bytes (ok)"
    fi
done

if [ "$fail" -ne 0 ]; then
    err "image size check FAILED - some images exceed ${MAX_IMAGE_BYTES} bytes"
    exit 1
fi
ok "image size check passed"
