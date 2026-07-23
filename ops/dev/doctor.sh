#!/usr/bin/env bash
#
# ops/dev/doctor.sh — pre-flight env check (read-only).
#
# Validates that everything ops/dev/{lifecycle,setup} need is in place —
# docker, compose, the right images, db volume mount target, ports not
# in use. Does NOT modify anything on disk or call docker compose.
#
# The runtime db is a `postgres:15-alpine` container in the same
# compose file (see docker-compose.dev.yml). doctor doesn't probe the
# db directly — if compose is up, the db is up; if compose is down,
# `lifecycle.sh start` will create it on next start. The only db-state
# check is whether the bind-mount target is writable (so the first
# start can create the data dir).
#
# Drift check (running containers vs local image tags) is appended.
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

    # db-bind-mount target writability. compose creates the dir on first
    # up if it doesn't exist, but the parent (./.dev) needs to be writable
    # by the docker daemon user.
    local pg_data_dir="./.dev/data/postgres"
    if [ ! -d "$pg_data_dir" ]; then
        # Not existing yet is fine (compose will mkdir it).
        info "  $pg_data_dir 还不存在 — 首次 start 时 compose 会创建空 db"
    elif [ -w "$pg_data_dir" ]; then
        ok "  $pg_data_dir 可写"
    else
        err "  $pg_data_dir 存在但不可写 — sudo chown $USER:$USER $pg_data_dir"
        failed=1
    fi

    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"

    # Optional: live db health probe if compose is up.
    if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db &>/dev/null 2>&1; then
        local cid
        cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1)"
        if [ -n "$cid" ] && docker inspect "$cid" \
            --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
            ok "db 容器 healthcheck: healthy"
        fi
    fi

    echo "--- drift check (running containers vs local image tags) ---"
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
