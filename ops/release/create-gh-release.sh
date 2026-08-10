#!/usr/bin/env bash
#
# ops/release/create-gh-release.sh - gh release create (prerelease for rc tags).
#
# Idempotent: skips if the release already exists for NEW_TAG. Tags ending
# in -rc.N are published as --prerelease so they do not show up as the
# "Latest" release on the GH releases page; promote.sh (in ops/publish/)
# later creates the matching non-prerelease vX.Y.Z release when the rc
# is consumed.
#
# Required env vars (exported by release-build.yml):
#   NEW_TAG - the resolved rc tag, e.g. v0.4.0-rc.1
#   GH_TOKEN - with contents: write (exported from secrets.GITHUB_TOKEN)

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
[ -n "${NEW_TAG:-}" ] || { err "NEW_TAG required"; exit 1; }
[ -n "${GH_TOKEN:-}" ] || { err "GH_TOKEN required (exported from secrets.GITHUB_TOKEN)"; exit 1; }

if gh release view "$NEW_TAG" >/dev/null 2>&1; then
    info "release ${NEW_TAG} already exists - skipping create"
    exit 0
fi

info "gh release create ${NEW_TAG} --prerelease --generate-notes"
gh release create "$NEW_TAG" --prerelease --generate-notes
ok "GH release created (${NEW_TAG}, prerelease)"
