#!/usr/bin/env bash
#
# Assert that a staging deploy record exists and is verified for the given ref.
# Called by publish-prod.yml BEFORE deploying to prod.
# Exits 0 if verified, 1 otherwise.

# Required env vars (set by the calling workflow):
#   GH_TOKEN - GitHub token with deployments: read
#   REPO     - owner/repo
#   REF      - the rc tag (vX.Y.Z-rc.N) to assert

set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${REF:?REF is required}"

echo "[assert-staging] checking for verified staging record for $REF..."

DEPLOY_IDS=$(gh api "repos/$REPO/deployments?ref=$REF" \
    --jq ".[] | select(.environment==\"staging\") | .id" 2>/dev/null || true)

if [ -z "$DEPLOY_IDS" ]; then
    echo "::error::no staging deploy record for $REF"
    echo "  hint: run staging.yml (mode: validate) first and verify it passes"
    exit 1
fi

LATEST_ID=$(echo "$DEPLOY_IDS" | head -1)
STATE=$(gh api "repos/$REPO/deployments/$LATEST_ID/statuses" --jq ".[0].state" 2>/dev/null || true)

if [ "$STATE" != "success" ]; then
    echo "::error::latest staging deploy for $REF has state=$STATE (expected success)"
    echo "  hint: re-run staging.yml (mode: validate) and verify it passes"
    exit 1
fi

echo "[assert-staging] OK: staging verified for $REF (deployment_id=$LATEST_ID)"
