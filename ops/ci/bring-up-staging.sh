#!/usr/bin/env bash
#
# Bring up the ephemeral staging stack (db + backend + frontend + nginx).
# Used by deploy-staging.yml and deploy-staging-review.yml.
#
# Required env vars (set by the calling workflow):
#   DOCKER_REGISTRY  - e.g. ghcr.io/<owner>/type-any-language
#   IMAGE_TAG        - the rc tag (vX.Y.Z-rc.N)
#   DB_PASSWORD      - staging db password (workflow-generated random)
#   ALLOWED_ORIGINS  - CORS allowlist (default "*")

set -euo pipefail

: "${DOCKER_REGISTRY:?DOCKER_REGISTRY is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-/api}"

cd "$(dirname "$0")/../staging"

echo "[bring-up-staging] pulling images ($DOCKER_REGISTRY/*:$IMAGE_TAG)..."
docker compose -p tal-staging pull --quiet

echo "[bring-up-staging] starting stack..."
docker compose -p tal-staging up -d --no-build

echo "[bring-up-staging] waiting for backend to become ready..."
for i in $(seq 1 30); do
    if curl -fsS http://localhost:8080/api/vocabulary/libs >/dev/null 2>&1; then
        echo "[bring-up-staging] backend ready after ${i} attempt(s)"
        exit 0
    fi
    sleep 2
done

echo "::error::backend never became ready (waited 60s)"
echo "::group::staging stack logs"
docker compose -p tal-staging logs --tail=50
echo "::endgroup::"
exit 1
