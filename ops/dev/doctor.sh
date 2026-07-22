#!/usr/bin/env bash
#
# ops/dev/doctor.sh — pre-flight env check (read-only).
#
# Validates that everything ops/dev/{lifecycle,setup} need is in place —
# docker, compose, the right images, .secrets/database_url (cloud-db
# contract), ports not in use. Does NOT modify anything on disk or call
# docker compose.
#
# Drift check (running containers vs local VERSION) is appended.
#
# Exit: 0 if all required checks pass; 1 if any required check fails.
#
# Counterpart to ops/dev/{lifecycle,setup,logs,migrate,watch}.sh.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_doctor() {
    local failed=0
    echo "=== Development environment check ==="
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

    # Cloud-db contract: backend reads DATABASE_URL_FILE which points at
    # .secrets/database_url. Self-hosted/CI operators use DATABASE_URL
    # shell env instead — that's equally valid.
    if [ -f "$DB_URL_FILE" ]; then
        ok ".secrets/database_url 存在 — backend 会通过 secrets: 挂载进容器"
        # Best-effort reachability probe (skip if psql not installed).
        if command -v psql &> /dev/null; then
            local db_url
            db_url="$(awk 'NR==1' "$DB_URL_FILE" 2>/dev/null)"
            if [ -n "$db_url" ]; then
                if PGPASSWORD= psql "$db_url" -c 'select 1' &>/dev/null; then
                    ok "  cloud db 可达 ($(awk -F/ '{print $3}' <<<"$db_url"))"
                else
                    warn "  cloud db 不可达 — 检查 .secrets/database_url + 网络/凭据"
                fi
            fi
        else
            info "  psql 未安装 — 跳过可达性探测(只验文件存在)"
        fi
    elif [ -n "${DATABASE_URL:-}" ]; then
        ok "DATABASE_URL 在 shell env(自管 db / CI)"
    else
        err ".secrets/database_url 不存在 且 DATABASE_URL 未设 — 云 db 未配置"
        info "  → ./ops/dev/setup.sh bootstrap    # 一次性: cloud-db ROLE/DB + .secrets/database_url"
        info "  → 或从 peer dev 主机拷过来: scp peer-dev:.secrets/database_url .secrets/"
        info "  → 或 export DATABASE_URL=postgres://... (自管 / CI)"
        failed=1
    fi

    if check_docker_installed && check_docker_daemon_running; then
        if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
            ok "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 存在"
        else
            warn "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 缺失 → 运行 ops/dev/build_image.sh"
        fi
        if image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
            ok "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 存在"
        else
            warn "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 缺失 → 运行 ops/dev/build_image.sh"
        fi
    fi

    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"

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