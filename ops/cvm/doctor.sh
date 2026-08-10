#!/usr/bin/env bash
#
# ops/cvm/doctor.sh — verify external dependencies for the prod CVM.
#
# Reads the host + reports whether things-from-outside-this-host are in
# place. Read-only: does NOT modify anything on disk or touch containers.
#
# Scope: external dependencies only. The host-side prep steps
# (docker, secrets, data dir, nginx site, port 80) are handled by
# bootstrap.sh's install/init scripts — re-run bootstrap.sh if any of
# those are missing, no need to call doctor for them.
#
# Checks:
#   1. DOCKER_REGISTRY env var       - is the registry namespace set?
#   2. 3 images pullable             - can we fetch db / backend / frontend
#                                     from the registry right now?
#   3. drift check                    - if containers are running, do their
#                                     image LABELs match the resolved VERSION?
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

    # ─── 3. Drift check ────────────────────────────────────────────────
    # Compares each running container's image LABEL
    # (`type-any-language.app.version`) against the resolved image tag.
    # Mismatch means compose was started with a different tag than the
    # running image — usually means someone pulled an image manually and
    # skipped lifecycle.sh restart.
    info "--- drift check (running containers vs local VERSION) ---"
    drift_check
    echo ""

    if [ $failed -eq 0 ]; then
        ok "所有外部依赖就绪"
        return 0
    else
        err "部分外部依赖未就绪 — 看上面提示"
        return 1
    fi
}

cmd_doctor
