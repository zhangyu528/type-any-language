#!/usr/bin/env bash
#
# ops/cvm/deploy-if-published.sh — final step of bootstrap.sh.
#
# Probes the registry for a published image; if reachable, pulls + brings
# up the stack via lifecycle.sh and runs a best-effort ops/doctor.sh. Skips
# gracefully (exit 0) when no image is published yet — bootstrap.sh
# considers host prep the contract, not the deploy.
#
# Called by bootstrap.sh::cmd_prepare. Can also be invoked standalone:
#   BOOTSTRAP_SKIP_DEPLOY=0 ./ops/cvm/deploy-if-published.sh
#
# Required env (set by bootstrap.sh via _common.sh::setup_prod_host_env):
#   BACKEND_FULL_IMAGE   - full registry/image:tag, used for the probe
#   BACKEND_IMAGE_TAG    - bare tag (echoed in the success message)
# Env knobs:
#   BOOTSTRAP_SKIP_DEPLOY=1  - skip entirely (host prep only).

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"

# setup_prod_host_env populates BACKEND_FULL_IMAGE / BACKEND_IMAGE_TAG from
# VERSION files. bootstrap.sh already ran this; re-running here is safe
# + cheap and makes the script standalone-invokable.
setup_prod_host_env

# ─── Skip gate ─────────────────────────────────────────────────────────
if [ "${BOOTSTRAP_SKIP_DEPLOY:-0}" = "1" ]; then
    info "=== deploy === (跳过: BOOTSTRAP_SKIP_DEPLOY=1)"
    exit 0
fi
info "=== deploy (if published) ==="

# ─── 1. Reachability probe ─────────────────────────────────────────────
# `docker manifest inspect` requires creds for private repos. GHCR is
# public for our package, so this is unauthenticated by default. If the
# repo becomes private, this probe needs `docker login ghcr.io` first.
probe="${BACKEND_FULL_IMAGE}"
info "  探针镜像: $probe"
if ! docker manifest inspect "$probe" >/dev/null 2>&1; then
    warn "未检测到已发布的镜像 ($probe)"
    info "  → 先跑 .github/workflows/release/build.yml 发布镜像,然后重跑 bootstrap.sh"
    info "  → 或设 BOOTSTRAP_SKIP_DEPLOY=1 仅做主机层准备"
    exit 0
fi

# ─── 2. Pull ────────────────────────────────────────────────────────────
# The manifest probe passed (registry can describe the image) but pull
# can still fail (auth, network). The compose() wrapper pulls all 3
# images in one call.
info "检测到已发布镜像,拉取并启动 (tag=$BACKEND_IMAGE_TAG)..."
if ! compose pull; then
    warn "拉取镜像失败 ($probe) — 可能未登录 GHCR 或无网络,跳过部署"
    info "  → 确保 CVM 能拉取 GHCR(ghcr.io login),然后重跑 bootstrap.sh"
    exit 0
fi

# ─── 3. Bring up + verify ─────────────────────────────────────────────
bash "$PROJECT_DIR/ops/cvm/lifecycle.sh" start
# Best-effort health check — don'\''t fail bootstrap if doctor is unhappy.
bash "$PROJECT_DIR/ops/doctor.sh" || true
ok "=== 部署并启动完成 (tag=$BACKEND_IMAGE_TAG) ==="
info "  访问: 前端 http://localhost  API http://localhost/api/docs"
