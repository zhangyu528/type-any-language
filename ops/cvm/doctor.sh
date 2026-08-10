#!/usr/bin/env bash
#
# ops/cvm/doctor.sh — pre-flight env check (read-only).
#
# Updated 2026-08-04: no longer checks gh CLI (CVM doesn't need gh —
# DOCKER_REGISTRY is injected by the deploy workflow via SSH env).
#
# Validates that everything ops/cvm/{lifecycle,bootstrap} need is in
# place. Does NOT modify anything on disk or bring containers up/down.
#
# Drift check (running containers vs local VERSION) is appended.
#
# Exit: 0 if all required checks pass; 1 otherwise.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_doctor() {
    local failed=0
    echo "=== Production environment check ==="
    echo ""

    if check_docker_installed; then
        ok "docker 已安装: $(docker --version 2>&1 | head -1)"
    else
        err "docker 未安装"; failed=1
    fi

    if check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行"; failed=1
    fi

    if detect_compose_cmd 2>/dev/null; then
        ok "compose: $DOCKER_COMPOSE_CMD"
    else
        err "未找到 docker-compose / docker compose"; failed=1
    fi

    # Db contract: prod compose reads .secrets/db_password via the
    # `secrets:` block; the db service uses POSTGRES_PASSWORD_FILE.
    # DATABASE_URL is built at compose env-block evaluation time using
    # $(cat /run/secrets/db_password) — not stored anywhere on host.
    if [ -f "$DB_PASSWORD_FILE" ]; then
        ok ".secrets/db_password 存在 — compose 会通过 secrets: 注入 db 容器"
        chmod 600 "$DB_PASSWORD_FILE"
    else
        err ".secrets/db_password 不存在 — db 容器无密码"
        info "  → ./ops/cvm/bootstrap.sh       # 首次部署自动生成"
        info "  → 或手动: openssl rand -hex 32 > .secrets/db_password && chmod 600"
        failed=1
    fi

    # Note: doctor also used to check db reachability via psql, but the
    # prod compose does NOT expose db's 5432 to host — only backend talks
    # to db via the internal network. Reachability is verified through
    # backend's verify_schema_up_to_date startup check, not here.

    if check_docker_installed && check_docker_daemon_running; then
        if image_pullable "${BACKEND_FULL_IMAGE}"; then
            ok "image ${BACKEND_FULL_IMAGE} 存在 (registry 可拉)"
        else
            err "image ${BACKEND_FULL_IMAGE} 缺失 (registry 拉不到)"
            info "  → 走 CI 重新出包: .github/workflows/release-build.yml"
            info "  → 或手动: docker pull ${BACKEND_FULL_IMAGE}"
            failed=1
        fi
        if image_pullable "${FRONTEND_FULL_IMAGE}"; then
            ok "image ${FRONTEND_FULL_IMAGE} 存在 (registry 可拉)"
        else
            err "image ${FRONTEND_FULL_IMAGE} 缺失 (registry 拉不到)"
            info "  → 走 CI 重新出包: .github/workflows/release-build.yml"
            info "  → 或手动: docker pull ${FRONTEND_FULL_IMAGE}"
            failed=1
        fi
        if image_pullable "${DB_FULL_IMAGE}"; then
            ok "image ${DB_FULL_IMAGE} 存在 (registry 可拉)"
        else
            err "image ${DB_FULL_IMAGE} 缺失 (registry 拉不到)"
            info "  → 走 CI 重新出包: .github/workflows/release-build.yml"
            info "  → 或手动: docker pull ${DB_FULL_IMAGE}"
            failed=1
        fi
    fi

    # Data directory: db container bind-mounts /var/lib/.../postgres.
    # Required on the host BEFORE first deploy. If missing, the
    # container will create it but with wrong ownership (root), and
    # postgres will fail to start with EACCES.
    if [ -d "/var/lib/type-any-language/postgres" ]; then
        ok "/var/lib/type-any-language/postgres 存在"
    else
        err "/var/lib/type-any-language/postgres 不存在"
        info "  → 跑: ./ops/cvm/bootstrap.sh  (会 sudo mkdir + chown 999:999)"
        failed=1
    fi

    warn_port_in_use 80  "nginx 端口 (宿主机 80)"

    if [ -z "$DOCKER_REGISTRY" ]; then
        # Should not happen — setup_prod_host_env fails loud on missing
        # DOCKER_REGISTRY. But print a clear hint for manual runs.
        err "DOCKER_REGISTRY 未设置"
        info "  这个值应该由 deploy-prod workflow 通过 SSH env 注入"
        info "  release-prod/deploy-prod workflow 跑时自动注入"
        info "  手动跑: export DOCKER_REGISTRY=ghcr.io/zhangyu528/type-any-language"
        failed=1
    else
        ok "DOCKER_REGISTRY=$DOCKER_REGISTRY (source=${_DOCKER_REGISTRY_SOURCE:-workflow})"
    fi

    # gh CLI: NO LONGER required on CVM (2026-08-04).
    # DOCKER_REGISTRY is now injected by the deploy workflow via SSH env.
    # If CVM is being used manually, operator sets `export DOCKER_REGISTRY=...` once.
    # Doctor just verifies the env var is non-empty + format is sane (via
    # setup_prod_host_env which calls resolve_docker_registry).

    echo ""
    echo "--- drift check (running containers vs local VERSION) ---"
    drift_check

    echo ""
    if [ $failed -eq 0 ]; then
        ok "所有必需检查通过"
        return 0
    else
        err "部分必需检查未通过"
        return 1
    fi
}

cmd_doctor