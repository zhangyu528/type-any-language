#!/usr/bin/env bash
#
# ops/release/push-latest.sh - retag + push each release image with the
# mutable `:latest` tag, so a host with no explicit IMAGE_TAG (e.g. a bare
# `make prod-bootstrap` that pulls `latest`) can fetch the newest published
# build zero-config.
#
# NOTE: if GHCR has immutable tags enabled for any of these packages,
# re-pushing :latest will fail. Either disable immutable tags for the
# :latest tag, or pin via IMAGE_TAG.
#
# Required env vars (exported by release-build.yml):
#   NEW_TAG         - the resolved rc tag (source of truth)
#   DOCKER_REGISTRY - registry namespace

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
require_release_env

info "tag + push :latest for ${NEW_TAG}"

for img in "${RELEASE_IMAGES[@]}"; do
    src="$(image_full_name "$img" "$NEW_TAG")"
    dst="$(image_full_name "$img" "latest")"
    info "  ${src} -> ${dst}"
    docker tag "$src" "$dst"
    docker push "$dst"
done

ok "pushed :latest for all ${#RELEASE_IMAGES[@]} images (NEW_TAG=${NEW_TAG})"
