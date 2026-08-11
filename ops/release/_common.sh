#!/bin/bash
#
# ops/release/_common.sh - shared helpers for the release scripts.
#
# Sourced by every script in ops/release/. Single source of truth for:
#   - the canonical image-name list (english_db / english_backend / english_frontend)
#   - the image-size budget
#   - full-image-name assembly
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - All env-driven inputs (NEW_TAG, DOCKER_REGISTRY, GIT_SHA, GH_TOKEN) are
#     validated by the caller; this file only declares constants.
#
# Runtime model: every script in this folder is invoked by a GH Actions step
# in release-build.yml. They are NOT designed to be run interactively
# (release-build.yml is the only entry point for image release).

set -euo pipefail

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Constants ────────────────────────────────────────────────────────────
# The 3 images the prod stack is composed of. Every release script that
# loops over images uses this list. To add a 4th image later (e.g. a sidecar),
# append it here AND add its Dockerfile to build_image_for().
RELEASE_IMAGES=(english_db english_backend english_frontend)

# Image-size budget. The release-build workflow fails the build if any image
# exceeds this. 500 MB is generous for the current stack (the actual largest
# is the frontend at ~120 MB); bump this if you intentionally grow an image.
: "${MAX_IMAGE_BYTES:=500000000}"

# ─── require_release_env ─────────────────────────────────────────────────
# Validates the env vars every release script reads. The caller sources this
# helper; exits 1 on any missing input so the workflow's `set -e` surfaces a
# clear failure. Returns 0 only when ALL of: NEW_TAG, DOCKER_REGISTRY are set.
# (GIT_SHA + GH_TOKEN are required only by build.sh / create-gh-release.sh
# respectively; those scripts check themselves so this stays minimal.)
require_release_env() {
    local missing=()
    [ -n "${NEW_TAG:-}" ]       || missing+=("NEW_TAG")
    [ -n "${DOCKER_REGISTRY:-}" ] || missing+=("DOCKER_REGISTRY")
    if [ "${#missing[@]}" -gt 0 ]; then
        err "missing required env: ${missing[*]}"
        info "  these are exported by release-build.yml from the workflow context"
        return 1
    fi
}

# ─── image_full_name ─────────────────────────────────────────────────────
# Compose the fully-qualified image reference. Echoes "<registry>/<image>:<tag>".
image_full_name() {
    local image="$1"
    local tag="$2"
    echo "${DOCKER_REGISTRY}/${image}:${tag}"
}

# ─── build_image_for ─────────────────────────────────────────────────────
# Build a single image with the canonical arg set. Echoes the full image
# reference on stdout so the caller can capture it for the push step.
#
# Frontend has an extra --build-arg NEXT_PUBLIC_API_URL=/ (so the browser
# calls /api/... on the same origin via the host nginx). db and backend do
# not. Add more conditional --build-arg blocks here as new images appear.
build_image_for() {
    local image="$1"
    local tag="$2"
    local full
    full="$(image_full_name "$image" "$tag")"

    case "$image" in
        english_db)
            docker build \
                --build-arg APP_VERSION="${tag}" \
                --build-arg GIT_SHA="${GIT_SHA:-unknown}" \
                -f db/Dockerfile \
                -t "$full" .
            ;;
        english_backend)
            docker build \
                --build-arg APP_VERSION="${tag}" \
                --build-arg GIT_SHA="${GIT_SHA:-unknown}" \
                -f backend/Dockerfile \
                -t "$full" .
            ;;
        english_frontend)
            # NEXT_PUBLIC_API_URL=/ -> browser uses same-origin /api/... via host nginx.
            # Override via env to point at a cross-origin API (e.g. NEXT_PUBLIC_API_URL=https://api.example.com).
            docker build \
                --build-arg APP_VERSION="${tag}" \
                --build-arg GIT_SHA="${GIT_SHA:-unknown}" \
                --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-/}" \
                -f frontend/Dockerfile \
                -t "$full" frontend
            ;;
        *)
            err "build_image_for: unknown image '$image' (not in RELEASE_IMAGES)"
            return 1
            ;;
    esac
    echo "$full"
}
