#!/usr/bin/env bash
#
# Promote an rc tag to the final vX.Y.Z tag (the real version).
# Called by publish-prod.yml AFTER successful deploy + soak.
#
# Required env vars:
#   GH_TOKEN  - with contents: write (for tag push + release create)
#   REF       - the rc tag to promote (e.g. v0.4.0-rc.3)

set -euo pipefail

: "${GH_TOKEN:?required}"
: "${REF:?required}"

# Compute base version: strip -rc.N suffix
VERSION=$(echo "$REF" | sed -E "s/-rc\.[0-9]+\$//")
echo "[promote] $REF -> $VERSION"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

if git rev-parse "$VERSION" >/dev/null 2>&1; then
    echo "[promote] $VERSION already exists (no tag create needed)"
else
    git tag -a "$VERSION" -m "release $VERSION (from $REF)"
    git push origin "$VERSION"
    echo "[promote] created tag $VERSION"
fi

if gh release view "$VERSION" >/dev/null 2>&1; then
    echo "[promote] GH release $VERSION already exists"
else
    gh release create "$VERSION" --title "$VERSION" --notes "Promoted from $REF" --target "$REF"
    echo "[promote] created GH release $VERSION"
fi

echo "[promote] done."
