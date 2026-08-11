#!/usr/bin/env bash
#
# ops/release/push-git-tag.sh - git tag -a + push origin <NEW_TAG>.
#
# Idempotent: skips if the tag already exists locally (a re-run of
# release-build.yml with the same inputs will not blow up). The remote
# tag push is unconditional - if origin already has it, this is a no-op
# for the receiver.
#
# Required env vars (exported by release-build.yml):
#   NEW_TAG - the resolved rc tag, e.g. v0.4.0-rc.1

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
[ -n "${NEW_TAG:-}" ] || { err "NEW_TAG required"; exit 1; }

# Use the github-actions bot identity for the tag author. Same as the
# publish-prod.yml::promote.sh step - keeping the author consistent so
# `git log <tag>` shows one coherent release author across all the
# tags a single release creates.
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

if git rev-parse "$NEW_TAG" >/dev/null 2>&1; then
    info "tag ${NEW_TAG} already exists locally - skipping create"
else
    info "git tag -a ${NEW_TAG}"
    git tag -a "$NEW_TAG" -m "release ${NEW_TAG}"
fi

info "git push origin ${NEW_TAG}"
git push origin "$NEW_TAG"
ok "git tag pushed (${NEW_TAG})"
