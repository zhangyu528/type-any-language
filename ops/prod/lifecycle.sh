#!/usr/bin/env bash
#
# ops/prod/lifecycle.sh — start / stop / restart.
#
# Daily driver for the prod host. Reads ops/prod/_common.sh for shared
# setup (image refs, drift check).
#
# Runtime model: 3 services in this same compose file, all on a single CVM:
#   db       — english_db:${DB_IMAGE_TAG}  (custom image, applies migrations
#              and imports content on every container start)
#   backend  — FastAPI / uvicorn. Connects to db via DATABASE_URL env.
#   nginx    — reverse proxy on :80.
# All 3 image tags are resolved from per-segment VERSION files via
# setup_prod_host_env. The images are PULLED from ${DOCKER_REGISTRY}
# (GHCR) — `up` runs with --no-build, so compose never builds locally.
# Build is done once on the CI build side (release-prod).
#
# Subcommands:
#   start             bring up all 3 services (db + backend + nginx)
#                     compose auto-pulls on first start. Subsequent
#                     restarts reuse the local images.
#   stop              stop all 3 services (data persists in bind-mount)
#   restart|reload    recreate + re-read env (also recreates db so new
#                     migrations + content from new image take effect)

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_start() {
    # Pure action — no preflight. All checks live in doctor.sh
    # (single source of truth). Run `make prod-doctor` first if you
    # want a pre-flight check before starting.
    info "启动生产容器 (db + backend + nginx)..."
    # --no-build: on the RUN host we PULL from ${DOCKER_REGISTRY} (GHCR),
    # never build locally. (Build is the CI build-side job.)
    # --parallel=1: serialize image pulls. With the default (-1, unlimited)
    # compose fans out one stream per service in parallel; on a CVM with a
    # rate-limited egress to GHCR this saturates the per-IP concurrent
    # connection cap and each stream crawls at ~16-75 KB/s — 4 streams of
    # ~450MB then never finish within the 1800s command_timeout. Serializing
    # concentrates all bandwidth on a single stream and finishes in minutes.
    $DOCKER_COMPOSE_CMD --parallel=1 -f "$COMPOSE_FILE" up -d --no-build
    ok "服务已启动"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost${_LIB_NC}"
    echo -e "  API:    ${_LIB_BLUE}http://localhost/api/docs${_LIB_NC}"
    echo "  db:     ${DB_IMAGE}:${DB_IMAGE_TAG} on internal compose network (data: /var/lib/type-any-language/postgres)"
    echo "          db image 的 entrypoint 自动跑 migrations + import content"
}

cmd_stop() {
    require_docker
    info "停止生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

cmd_restart() {
    # Pure action — no preflight. All checks live in doctor.sh
    # (single source of truth). deploy.sh runs doctor before + after
    # this script; running lifecycle.sh directly is for ad-hoc reloads
    # when you already know the host is ready.
    info "重启容器(重新加载 image + env)..."

    local backend_before frontend_before db_before
    local backend_after frontend_after db_after
    backend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)
    db_before=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${DB_IMAGE}:${DB_IMAGE_TAG}" 2>/dev/null || true)

    # Recreate ALL 4 services (not just backend/nginx). With Layer 3, the
    # db image's entrypoint auto-applies migrations + imports content on
    # start — so recreating db is how new schema / content gets applied.
    # We also recreate frontend and nginx so new image tags take effect.
    # --no-build: PULL the new tags from ${DOCKER_REGISTRY} (GHCR) instead
    # of building locally.
    # --parallel=1: serialize image pulls (see cmd_start for the why).
    # Pre-pull each image up front with || true so a referrer-timeout on
    # docker.io images (nginx) doesn't fail the whole compose up — the
    # image itself is already pulled by the time we get to `up -d`, so
    # compose sees it locally and skips the pull-with-attestation step.
    # nginx is hardcoded in docker-compose.yml as `nginx:alpine` from
    # docker.io (see docker-compose.yml:137); the 3 custom images come
    # from ${DOCKER_REGISTRY} which is set from $vars.DOCKER_REGISTRY in
    # the deploy-prod workflow.
    info "pre-pulling 4 images individually (tolerate referrer failures)..."
    for img in \
      "${DB_IMAGE}:${DB_IMAGE_TAG}" \
      "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" \
      "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" \
      "nginx:alpine"
    do
      # DOCKER_REGISTRY is only meaningful for the 3 custom images; for
      # docker.io images (nginx) pull bare. But try with the registry
      # prefix first since it doesn't hurt — dockerd will resolve and
      # fall back to docker.io if needed.
      if [[ "$img" == "nginx:alpine" ]]; then
        target="nginx:alpine"
      else
        target="${DOCKER_REGISTRY}/${img}"
      fi
      sudo docker pull "$target" || warn "  $target pull finished with non-zero (likely referrer-timeout); proceeding if image is locally present"
    done
    echo ''
    $DOCKER_COMPOSE_CMD --parallel=1 -f "$COMPOSE_FILE" up -d --no-deps --force-recreate --no-build db backend frontend nginx

    backend_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)
    db_after=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${DB_IMAGE}:${DB_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$backend_before" ] && [ "$backend_before" != "$backend_after" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/prod/build/image.sh 重 build 后再 restart"
    fi
    if [ -n "$frontend_before" ] && [ "$frontend_before" != "$frontend_after" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/prod/build/image.sh 重 build 后再 restart"
    fi
    if [ -n "$db_before" ] && [ "$db_before" != "$db_after" ]; then
        warn "$DB_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  这种情况请用 ops/prod/build/image.sh 重 build 后再 restart"
    fi

    ok "服务已重启"
}

cmd_reload() { cmd_restart "$@"; }

usage() {
    cat <<EOF
用法: ./ops/prod/lifecycle.sh <command>

命令:
  start            启动生产容器(db + backend + nginx)
  stop             停止生产容器
  restart|reload   recreate + 重读 env (≈5s, 不重 build image)
                   db 容器也 recreate —— 新 image 的 entrypoint 会自动
                   apply migrations + import content。

典型工作流:
  # 日常 reload(改了 config / env,没改 image)
  ALLOWED_ORIGINS=https://my.domain ./ops/prod/lifecycle.sh restart

  # 发新版本(改完代码 + publish.sh 跑完后)
  ./ops/prod/lifecycle.sh restart    # 或 make prod-deploy(走 doctor)

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./ops/prod/lifecycle.sh start
  IMAGE_TAG=v0.5.0 ./ops/prod/lifecycle.sh start
EOF
}

case "${1:-}" in
    start)             cmd_start "$@" ;;
    stop)              cmd_stop "$@" ;;
    restart|reload)    cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
