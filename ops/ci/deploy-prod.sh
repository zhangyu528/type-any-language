#!/usr/bin/env bash
# Deploy to prod CVM: tar+scp ops scripts, then SSH + inline deploy.
# Called by publish-prod.yml after asserting staging was verified.

# Required env vars:
#   DOCKER_REGISTRY  - e.g. ghcr.io/<owner>/type-any-language
#   IMAGE_TAG        - the rc tag (vX.Y.Z-rc.N)
#   CVM_HOST         - public IP/hostname of prod CVM
#   CVM_USER         - SSH user (default: ubuntu)
#   CVM_KEY          - SSH private key contents
#   GHCR_USER        - GHCR username
#   GHCR_TOKEN       - GHCR token

set -euo pipefail

for v in DOCKER_REGISTRY IMAGE_TAG CVM_HOST CVM_KEY GHCR_USER GHCR_TOKEN; do
    if [ -z "${!v}" ]; then echo "::error::$v is required" >&2; exit 1; fi
done
CVM_USER="${CVM_USER:-ubuntu}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

KEYFILE=$(mktemp)
UFILE=$(mktemp)
TFILE=$(mktemp)
chmod 600 "$KEYFILE" "$UFILE" "$TFILE"
printf "%s" "$CVM_KEY" > "$KEYFILE"
printf "%s" "$GHCR_USER" > "$UFILE"
printf "%s" "$GHCR_TOKEN" > "$TFILE"
trap "rm -f $KEYFILE $UFILE $TFILE" EXIT

echo "[deploy-prod] packaging ops scripts..."
tar czf /tmp/prod-deploy.tar.gz ops/cvm ops/ci ops/lib.sh Makefile ops/cvm/docker-compose.yml

echo "[deploy-prod] scp tarball + creds to CVM..."
scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEYFILE" /tmp/prod-deploy.tar.gz "$UFILE" "$TFILE" "$CVM_USER@$CVM_HOST:/tmp/"

echo "[deploy-prod] ssh to CVM and run deploy (this takes 1-3 min for image pulls)..."

# Build the deploy script and pipe it through ssh.
# Use printf to construct the script (avoids here-doc escaping).
CVM_SCRIPT="$(cat <<XEOF
set -e
cd /opt/type-any-language
sudo rm -rf ops/prod ops/lib.sh
sudo tar xzf /tmp/prod-deploy.tar.gz
sudo chown -R deploy:deploy ops/cvm ops/ci Makefile ops/cvm/docker-compose.yml
rm -f /tmp/prod-deploy.tar.gz
chmod +x ops/prod/*.sh
export DOCKER_REGISTRY=__DR__
export IMAGE_TAG=__TAG__
echo "[cvm-deploy] IMAGE_TAG=$IMAGE_TAG  DOCKER_REGISTRY=$DOCKER_REGISTRY"
if [ -f /tmp/ghcr_user ] && [ -f /tmp/ghcr_token ]; then
    sudo docker login ghcr.io -u "$(cat /tmp/ghcr_user)" --password-stdin < /tmp/ghcr_token
    rm -f /tmp/ghcr_user /tmp/ghcr_token
fi
sudo -u deploy bash -lc "make prod-deploy"
XEOF
)"

# Substitute placeholders with actual values (no quoting needed since values are simple)
CVM_SCRIPT="${CVM_SCRIPT/__DR__/$DOCKER_REGISTRY}"
CVM_SCRIPT="${CVM_SCRIPT/__TAG__/$IMAGE_TAG}"

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEYFILE" "$CVM_USER@$CVM_HOST" "bash -s" <<< "$CVM_SCRIPT"

echo "[deploy-prod] done."
