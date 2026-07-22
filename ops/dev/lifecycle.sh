#!/usr/bin/env bash
#
# ops/dev/lifecycle.sh — start / stop / restart / reload.
#
# Daily driver for the dev host. Reads ops/dev/_common.sh for all
# shared setup (image refs, secrets write, watch lifecycle).
#
# Subcommands:
#   start             bring up dev containers + spawn compose watch (hot reload)
#   stop              stop compose watch + dev containers
#   restart|reload    recreate containers, re-read .secrets
#
# Counterpart to ops/dev/{setup,doctor,logs,migrate,watch}.sh.
#
# Usage:
#   ./ops/dev/lifecycle.sh start
#   ./ops/dev/lifecycle.sh stop
#   ./ops/dev/lifecycle.sh restart

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_start() {
    gate_preflight
    write_secrets
    info "启动开发容器..."
    # `--pull=never`: dev never auto-pulls on start. Image lifecycle is
    # local — `setup` does the one-time bootstrap pull when needed,
    # otherwise build_image.sh keeps local images fresh. Without
    # --pull=never, compose up -d defaults to `--pull=missing` and would
    # re-pull, overwriting a fresh local build or hitting 429 on
    # registries that don't host the image.
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never

    start_compose_watch

    ok "服务已启动(热重载已开启)"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost:3000${_LIB_NC}"
    echo -e "  后端:   ${_LIB_BLUE}http://localhost:8000${_LIB_NC}"
    echo -e "  API文档: ${_LIB_BLUE}http://localhost:8000/docs${_LIB_NC}"
    echo "  cloud db: $(awk -F/ '{print $3}' "$DB_URL_FILE" 2>/dev/null || echo '<not configured>')"
    echo "  compose watch: tail -f $WATCH_LOG_FILE   (前台跑: ./ops/dev/watch.sh)"
}

cmd_stop() {
    require_docker
    # Stop the watch process FIRST so it doesn't try to sync into a
    # container that's being torn down (would log noise + maybe race
    # against file removal).
    stop_compose_watch

    info "停止开发容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

cmd_restart() {
    gate_preflight
    write_secrets
    info "重启开发容器(重新加载 secrets)..."

    local backend_before frontend_before
    local backend_after frontend_after
    backend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend

    backend_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$backend_before" ] && [ "$backend_before" != "$backend_after" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/dev/build_image.sh 重 build 后再 restart"
    fi
    if [ -n "$frontend_before" ] && [ "$frontend_before" != "$frontend_after" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/dev/build_image.sh 重 build 后再 restart"
    fi

    ok "服务已重启(secrets 已重读)"
}

cmd_reload() { cmd_restart "$@"; }

usage() {
    cat <<EOF
用法: ./ops/dev/lifecycle.sh <command>

命令:
  start            启动 dev 容器(热重载) + 后台 spawn compose watch
  stop             stop compose watch + dev 容器
  restart|reload   recreate + 重读 secrets (≈5s, 不重 build image)

典型工作流:
  ./ops/dev/lifecycle.sh start
  # ...改代码 / .secrets / docker-compose.dev.yml 后...
  ./ops/dev/lifecycle.sh restart

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./ops/dev/lifecycle.sh start
  IMAGE_TAG=v1.2 ./ops/dev/lifecycle.sh start
EOF
}

case "${1:-}" in
    start)             cmd_start "$@" ;;
    stop)              cmd_stop "$@" ;;
    restart|reload)    cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
