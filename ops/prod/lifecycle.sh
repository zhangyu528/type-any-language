#!/usr/bin/env bash
#
# ops/prod/lifecycle.sh — start / stop / restart / reload.
#
# Daily driver for the prod host. Reads ops/prod/_common.sh for
# all shared setup (image refs, secrets write).
#
# Subcommands:
#   start             bring up prod containers (no auto-pull — the
#                     backend/frontend images were already built or
#                     pulled by setup/build_image.sh)
#   stop              stop prod containers
#   restart|reload    recreate + re-read .secrets
#
# Counterpart to ops/prod/{setup,doctor,logs}.sh.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_start() {
    gate_preflight
    write_secrets
    info "启动生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    ok "服务已启动"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost${_LIB_NC}"
    echo -e "  API:    ${_LIB_BLUE}http://localhost/api/docs${_LIB_NC}"
    echo "  cloud db: $(awk -F/ '{print $3}' "$DB_URL_FILE" 2>/dev/null || echo '<not configured>')"
}

cmd_stop() {
    require_docker
    info "停止生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

cmd_restart() {
    gate_preflight
    write_secrets
    info "重启容器(重新加载 secrets)..."

    local backend_before frontend_before
    local backend_after frontend_after
    backend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend

    backend_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$backend_before" ] && [ "$backend_before" != "$backend_after" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/prod/build_image.sh 重 build 后再 restart"
    fi
    if [ -n "$frontend_before" ] && [ "$frontend_before" != "$frontend_after" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/prod/build_image.sh 重 build 后再 restart"
    fi

    ok "服务已重启(secrets 已重读)"
}

cmd_reload() { cmd_restart "$@"; }

usage() {
    cat <<EOF
用法: ./ops/prod/lifecycle.sh <command>

命令:
  start            启动生产容器 (image 由 setup / build_image.sh 先准备好)
  stop             停止生产容器 (docker compose down)
  restart|reload   recreate + 重读 secrets (≈5s, 不重 build image)

典型工作流:
  ./ops/prod/lifecycle.sh start
  # ...改 .secrets / docker-compose.yml / 重新 build+push 了 image 后...
  ./ops/prod/lifecycle.sh restart

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./ops/prod/lifecycle.sh start
  IMAGE_TAG=v1.2 ./ops/prod/lifecycle.sh start
EOF
}

case "${1:-}" in
    start)             cmd_start "$@" ;;
    stop)              cmd_stop "$@" ;;
    restart|reload)    cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
