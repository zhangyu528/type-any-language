#!/usr/bin/env bash
#
# Write a GH Deployments record (env=staging, status=success).
# Called by staging.yml (mode: validate) after smoke/e2e/soak all pass.

# Required env vars (set by the calling workflow):
#   GH_TOKEN - GitHub token with deployments: write
#   REPO     - owner/repo (e.g. my-org/type-any-language)
#   REF      - the rc tag (vX.Y.Z-rc.N)
#   SHA      - the commit SHA
#   RUN_URL  - GH Actions run URL (for the log_url field)
# Optional:
#   STATUS   - default "success"

set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${REF:?REF is required}"
: "${SHA:?SHA is required}"
: "${RUN_URL:?RUN_URL is required}"
STATUS="${STATUS:-success}"

DEPLOY_ID=$(gh api "repos/$REPO/deployments" \
    -f ref="$REF" \
    -f environment=staging \
    -f description="staging deploy" \
    -f sha="$SHA" \
    --jq .id)

gh api "repos/$REPO/deployments/$DEPLOY_ID/statuses" \
    -f state="$STATUS" \
    -f description="smoke + e2e + soak verified" \
    -f log_url="$RUN_URL" \
    -f environment=staging

echo "::notice::Deployments record created: $DEPLOY_ID (state=$STATUS)"
