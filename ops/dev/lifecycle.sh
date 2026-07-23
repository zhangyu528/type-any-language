#!/usr/bin/env bash
#
# ops/dev/lifecycle.sh — start / stop / restart.
#
# Daily driver for the dev host. Reads ops/dev/_common.sh for all
# shared setup (image refs, watch lifecycle).
#
# The runtime database is a `postgres:15-alpine` container managed by
# this same compose file (db service). No external docker postgres, no
# secrets file indirection — DATABASE_URL is in compose environment.
#
# Subcommands:
#   start             bring up dev containers (db + backend + frontend)
#                     + spawn compose watch (hot reload)
#   stop              stop compose watch + dev containers
#   restart|reload    recreate containers
#
# Counterpart to ops/dev/{setup,doctor,logs,import_content,watch}.sh.
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
    info "启动开发容器 (db + backend + frontend)..."
    # `--pull=never`: dev never auto-pulls on start. Image lifecycle is
    # local — build_image.sh keeps local images fresh. Without
    # --pull=never, compose up -d defaults to `--pull=missing` for the
    # postgres image (which we DO want to pull) — to handle both,
    # we leave the postgres pull enabled but dev images not pulled.
    #
    # Implementation: --pull=never is for backend/frontend (local
    # already). The `db` service uses the postgres:15-alpine public
    # image which compose will pull on first up.
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d \
        --pull=never \
        --no-pull-backend-frontend=true \
        2>/dev/null || $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d

    start_compose_watch

    ok "服务已启动(热重载已开启)"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost:3000${_LIB_NC}"
    echo -e "  后端:   ${_LIB_BLUE}http://localhost:8000${_LIB_NC}"
    echo -e "  API文档: ${_LIB_BLUE}http://localhost:8000/docs${_LIB_NC}"
    echo "  db:     localhost:5432  (postgres:15-alpine, data 在 ./.dev/data/postgres/)"
    echo "  compose watch: tail -f $WATCH_LOG_FILE   (前台跑: ./ops/dev/watch.sh)"
}

cmd_stop() {
    require_docker
    # Stop the watch process FIRST so it doesn't try to sync into a
    # container that's being torn down.
    stop_compose_watch

    info "停止开发容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

cmd_restart() {
    gate_preflight
    info "重启开发容器(重新加载 image + env)..."

    local backend_before frontend_before
    local backend_after frontend_after
    backend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --force-recreate backend frontend

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

    ok "服务已重启"
}

cmd_reload() { cmd_restart "$@"; }

usage() {
    cat <<EOF
用法: ./ops/dev/lifecycle.sh <command>

命令:
  start            启动 dev 容器(db + backend + frontend)+ 后台 spawn compose watch
  stop             stop compose watch + dev 容器
  restart|reload   recreate + 重读 env (≈5s, 不重 build image)

典型工作流:
  ./ops/dev/lifecycle.sh start
  # ...改代码 / docker-compose.dev.yml / .env 后...
  ./ops/dev/lifecycle.sh restart

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./ops/dev/lifecycle.sh start
  IMAGE_DEV_TAG=my-branch-test ./ops/dev/lifecycle.sh start
EOF
}

case "${1:-}" in
    start)             cmd_start "$@" ;;
    stop)              cmd_stop "$@" ;;
    restart|reload)    cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
