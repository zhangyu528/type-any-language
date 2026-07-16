#!/usr/bin/env bash
#
# ops/prod/lifecycle.sh — start / stop / restart / reload.
#
# Daily driver for the prod host. Reads ops/prod/_common.sh for
# all shared setup (image refs, db label inspection, secrets write,
# registry auto-pull).
#
# Subcommands:
#   start             bring up prod containers (auto-pulls db image if
#                     DOCKER_REGISTRY is set)
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
    if ! inspect_db_image_labels; then
        err "content-baked db image 缺少 type-any-language.* labels — 用 db/scripts/build.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
    info "启动生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    ok "服务已启动"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost${_LIB_NC}"
    echo -e "  API:    ${_LIB_BLUE}http://localhost/api/docs${_LIB_NC}"
    echo "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
}

cmd_stop() {
    require_docker
    info "停止生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

cmd_restart() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "content-baked db image 缺少 type-any-language.* labels — 用 db/scripts/build.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
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
  start            启动生产容器 (DOCKER_REGISTRY 配了会先 pull baked db image)
  stop             停止生产容器 (docker compose down)
  restart|reload   recreate + 重读 secrets (≈5s, 不重 build image)

典型工作流:
  ./ops/prod/lifecycle.sh start
  # ...改 .secrets / docker-compose.yml / 重新 push 了 db image 后...
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
