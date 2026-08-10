#!/usr/bin/env bash
#
# ops/cvm/doctor.sh — read-only health snapshot for the prod CVM.
#
# External-dependency check: validates the registry side of the deploy
# (DOCKER_REGISTRY env, image reachability). Read-only — does NOT touch
# the host or containers.
#
# Use:
#   - bootstrap.sh?    No — bootstrap covers host-side prep (docker,
#                       secrets, data dir, nginx). Re-run bootstrap if
#                       those are wrong.
#   - post-deploy?     Yes — run after publish-prod finishes to confirm
#                       the registry actually has the images we expect.
#   - ad-hoc / debug?  Yes — operators run this when "something feels
#                       off" to quickly see if the registry side is OK.
#
# Checks:
#   1. DOCKER_REGISTRY env var    - is the registry namespace set?
#   2. 3 images pullable           - can we fetch db / backend / frontend
#                                    from the registry right now?
#
# Exit: 0 if all pass, 1 if any fails.
#
# Run standalone:    ./ops/cvm/doctor.sh
# Also called from:  publish-prod.yml workflow after a deploy (via SSH)

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_doctor() {
    local failed=0
    echo "=== External dependency check ==="
    echo ""

    # ─── 1. DOCKER_REGISTRY ────────────────────────────────────────────
    # setup_prod_host_env above already validated + exported DOCKER_REGISTRY
    # (fails loud if missing). Here we just report + hint for manual runs.
    if [ -z "$DOCKER_REGISTRY" ]; then
        err "DOCKER_REGISTRY 未设置"
        info "  deploy-prod workflow 通过 SSH env 自动注入"
        info "  手动跑: export DOCKER_REGISTRY=ghcr.io/zhangyu528/type-any-language"
        failed=1
    else
        ok "DOCKER_REGISTRY=$DOCKER_REGISTRY (source=${_DOCKER_REGISTRY_SOURCE:-workflow})"
    fi
    echo ""

    # ─── 2. Image reachability ─────────────────────────────────────────
    # docker manifest inspect requires creds for private repos; our GHCR
    # packages are public so this is unauthenticated by default.
    info "--- image reachability (3 images) ---"
    if ! check_docker_installed || ! check_docker_daemon_running; then
        err "  docker daemon 不可用 — 跳过 image 探测"
        failed=1
    else
        local img
        for img in "$DB_FULL_IMAGE" "$BACKEND_FULL_IMAGE" "$FRONTEND_FULL_IMAGE"; do
            if image_pullable "$img"; then
                ok "  $img 存在"
            else
                err "  $img 缺失(registry 拉不到)"
                info "    走 CI 重新出包: .github/workflows/release/build.yml"
                info "    或手动: docker pull $img"
                failed=1
            fi
        done
    fi
    echo ""

    if [ $failed -eq 0 ]; then
        ok "registry 端就绪"
        return 0
    else
        err "部分外部依赖未就绪 — 看上面提示"
        return 1
    fi
}

cmd_doctor
