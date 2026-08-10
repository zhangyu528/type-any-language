#!/usr/bin/env bash
#
# Smart tag resolution for release-build.yml.
#
# Given optional inputs (version, bump_type, force_rc), decides what the
# next vX.Y.Z-rc.N tag should be. Single source of truth for tag arithmetic.
#
# Usage (called by workflows):
#   resolve-tag.sh                  # auto: continue or bump
#   resolve-tag.sh auto             # same as above (explicit)
#   resolve-tag.sh 0.4.0            # manually specify version
#   resolve-tag.sh 1.0.0 major      # specify version + bump class
#   resolve-tag.sh 0.4.0 "" 3       # force rc=3
#
# Output (printed to stdout for caller to capture):
#   NEW_TAG=vX.Y.Z-rc.N

set -euo pipefail

INPUT_VERSION="${1:-}"
BUMP_TYPE="${2:-patch}"
FORCE_RC="${3:-}"

bump_version() {
    local v="$1"
    local type="$2"
    local major minor patch
    major=$(echo "$v" | cut -d. -f1)
    minor=$(echo "$v" | cut -d. -f2)
    patch=$(echo "$v" | cut -d. -f3)
    case "$type" in
        major) echo "$((major + 1)).0.0" ;;
        minor) echo "${major}.$((minor + 1)).0" ;;
        patch) echo "${major}.${minor}.$((patch + 1))" ;;
        *) echo "::error::unknown bump_type: $type" >&2; exit 1 ;;
    esac
}

# Find latest rc series currently in use
LATEST_RC_TAG=$(git tag -l "v*-rc.*" --sort=-v:refname 2>/dev/null | head -1 || true)
if [ -z "$LATEST_RC_TAG" ]; then
    CURRENT_VERSION=""
else
    CURRENT_VERSION=$(echo "$LATEST_RC_TAG" | sed -E "s/-rc\.[0-9]+$//")
fi

# Decide base version (treat "auto" or empty as auto-resolve)
if [ -n "$INPUT_VERSION" ] && [ "$INPUT_VERSION" != "auto" ]; then
    NEW_VERSION="$INPUT_VERSION"
    if git tag -l "v${NEW_VERSION}" | grep -q .; then
        echo "::error::v${NEW_VERSION} already promoted" >&2
        SUGGEST=$(bump_version "$NEW_VERSION" patch)
        echo "        pick a fresh version (e.g. v${SUGGEST})" >&2
        exit 1
    fi
else
    if [ -z "$CURRENT_VERSION" ]; then
        NEW_VERSION="0.1.0"
    elif git tag -l "${CURRENT_VERSION}" | grep -q .; then
        NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$BUMP_TYPE")
    else
        NEW_VERSION="$CURRENT_VERSION"
    fi
fi

# Pick rc.N
if [ -n "$FORCE_RC" ]; then
    RC_NUM="$FORCE_RC"
else
    LATEST_RC=$(git tag -l "v${NEW_VERSION}-rc.*" --sort=-v:refname 2>/dev/null | head -1 || true)
    if [ -z "$LATEST_RC" ]; then
        RC_NUM=1
    else
        N=$(echo "$LATEST_RC" | grep -oE "[0-9]+$")
        RC_NUM=$((N + 1))
    fi
fi

NEW_TAG="v${NEW_VERSION}-rc.${RC_NUM}"

# Emit on stdout (caller captures this); diagnostics on stderr
echo "$NEW_TAG"
echo "[resolve-tag] resolved: $NEW_TAG" >&2
echo "[resolve-tag]   base version: $NEW_VERSION" >&2
echo "[resolve-tag]   rc number: $RC_NUM" >&2
if [ -n "$INPUT_VERSION" ] && [ "$INPUT_VERSION" != "auto" ]; then
    echo "[resolve-tag]   reason: operator pinned version" >&2
elif [ -z "$CURRENT_VERSION" ]; then
    echo "[resolve-tag]   reason: first release" >&2
elif git tag -l "${CURRENT_VERSION}" | grep -q .; then
    echo "[resolve-tag]   reason: ${CURRENT_VERSION} was promoted, bumped to $NEW_VERSION" >&2
else
    echo "[resolve-tag]   reason: continuing rc series under ${CURRENT_VERSION}" >&2
fi
