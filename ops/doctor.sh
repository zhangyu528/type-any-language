#!/usr/bin/env bash
#
# ops/doctor.sh — read-only health snapshot for the prod CVM.
#
# At ops/ root (NOT under cvm/) because it covers things beyond the
# CVM runtime:
#
#   - DOCKER_REGISTRY env + 3-image registry reachability
#     (external dependencies — registry is "outside" the CVM)
#   - drift_check
#     (post-deploy verification: does what's running match what's tagged?)
#
# Use:
#   - bootstrap.sh?    No — bootstrap covers host-side prep (docker,
#                       secrets, data dir, nginx). Re-run bootstrap if
#                       those are wrong.
#   - post-deploy?     Yes — publish-prod runs this after a successful
#                       deploy to confirm registry + drift are clean.
#   - ad-hoc / debug?  Yes — operators run this when "something feels
#                       off" to quickly see if external state is OK.
#
# Read-only: does NOT modify anything on disk or touch containers.
#
# Exit: 0 if all pass, 1 if any fails.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
setup_prod_host_env

cmd_doctor() {
    local failed=0
    echo "=== External + post-deploy health check ==="
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

    # ─── 3. Drift check ────────────────────────────────────────────────
    # Post-deploy verification: each running container's image LABEL
    # (type-any-language.app.version, baked at build time from
    # --build-arg APP_VERSION=${IMAGE_TAG}) should match the tag resolved
    # from IMAGE_TAG env. Mismatch = drift.
    #
    # Pre-condition: setup_prod_host_env already populated the *_IMAGE_TAG
    # vars from IMAGE_TAG env. If no containers are running, drift_check
    # returns 0 (no-op).
    info "--- drift check (running containers vs resolved IMAGE_TAG) ---"
    drift_check
    echo ""

    if [ $failed -eq 0 ]; then
        ok "external + post-deploy 状态正常"
        return 0
    else
        err "部分检查未通过 — 看上面提示"
        return 1
    fi
}

cmd_doctor
