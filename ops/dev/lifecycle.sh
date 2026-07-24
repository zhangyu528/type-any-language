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
    # Pull postgres:15-alpine explicitly on the host (bypassing compose's
    # --pull=never, which would block the db image too). backend/frontend
    # images are local-only — `build_image.sh` keeps them fresh and
    # `compose up --pull=never` keeps compose from pulling a stale
    # registry tag in case DOCKER_REGISTRY is set.
    #
    # Earlier this script passed a non-existent `--no-pull-backend-frontend=true`
    # flag and silently fell back to `compose up -d` without --pull=never,
    # which could pull a stale registry tag for backend/frontend in
    # setups with DOCKER_REGISTRY set. Pulling the postgres image
    # explicitly here keeps backend/frontend local while letting the
    # db come from Docker Hub on first start.
    if ! image_exists "$DB_IMAGE"; then
        info "  拉 $DB_IMAGE (首次启动需要)..."
        if ! docker pull "$DB_IMAGE"; then
            err "  拉 $DB_IMAGE 失败 — 检查网络 / 镜像名"
            return 1
        fi
    fi

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never

    start_compose_watch

    # Empty-db hint: if the db is up but vocabulary_libs is empty, the
    # operator forgot to import content (or just set up a fresh db).
    # Point them at import_content.sh which can also auto-start the db
    # if needed.
    warn_if_db_empty

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
    # cmd_restart receives "$@" from the case dispatcher, which is the
    # full argv slice AFTER `restart`. So `./lifecycle.sh restart backend`
    # enters this function with $1=backend, not $1=restart.
    local svcs=("$@")
    if [ ${#svcs[@]} -eq 0 ]; then
        svcs=(backend frontend)
        info "重启开发容器(重新加载 image + env)..."
    else
        info "重启服务: ${svcs[*]}"
    fi

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --force-recreate "${svcs[@]}"

    # --force-recreate on the frontend tears down the container the
    # background compose watch was syncing into. Re-spawn the watch
    # against the new container so HMR keeps working.
    # Skip the watch restart if the user only restarted db/backend —
    # frontend (the watch's sync target) wasn't touched.
    local needs_watch_restart=0
    for s in "${svcs[@]}"; do
        if [ "$s" = "frontend" ]; then
            needs_watch_restart=1
            break
        fi
    done
    if [ $needs_watch_restart -eq 1 ]; then
        restart_compose_watch
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
  BACKEND_DEV_TAG=my-test  ./ops/dev/lifecycle.sh start
  FRONTEND_DEV_TAG=my-test ./ops/dev/lifecycle.sh start
  IMAGE_DEV_TAG=my-test    ./ops/dev/lifecycle.sh start   # both
EOF
}

case "${1:-}" in
    start)             shift; cmd_start "$@" ;;
    stop)              shift; cmd_stop "$@" ;;
    restart|reload)    shift; cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
