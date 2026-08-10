#!/usr/bin/env bash
#
# ops/cvm/lifecycle.sh — start / stop / restart.
#
# Daily driver for the CVM. Reads ops/cvm/_common.sh for shared setup
# (image refs, the compose() wrapper, drift check).
#
# Runtime model: 3 containerised services, all on a single CVM:
#   db       — english_db:${DB_IMAGE_TAG}  (custom image, applies migrations
#              and imports content on every container start)
#   backend  — FastAPI / uvicorn. Assembles DATABASE_URL at boot.
#   frontend — Next.js standalone server on :3000.
# nginx is the host's system nginx (apt), NOT a compose service — see
# ops/cvm/nginx/site.conf and ops/cvm/nginx/install.sh.
#
# All 3 image tags are resolved via setup_prod_host_env (IMAGE_TAG env,
# forwarded from the git tag by ops/publish/deploy-prod.sh). The images are
# PULLED from ${DOCKER_REGISTRY} (GHCR) — `up` runs with --no-build, so
# compose never builds locally. Build happens once in CI
# (.github/workflows/release-build.yml).
#
# Subcommands:
#   start             bring up all 3 services (db + backend + frontend)
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
    info "启动生产容器 (db + backend + frontend)..."
    # --no-build: on the RUN host we PULL from ${DOCKER_REGISTRY} (GHCR),
    # never build locally. (Build is the CI build-side job.)
    # --parallel=1: serialize image pulls. With the default (-1, unlimited)
    # compose fans out one stream per service in parallel; on a CVM with a
    # rate-limited egress to GHCR this saturates the per-IP concurrent
    # connection cap and each stream crawls at ~16-75 KB/s — 3 streams of
    # ~450MB then never finish within the 1800s command_timeout. Serializing
    # concentrates all bandwidth on a single stream and finishes in minutes.
    compose --parallel=1 up -d --no-build
    ok "服务已启动"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost${_LIB_NC}"
    echo -e "  API:    ${_LIB_BLUE}http://localhost/api/docs${_LIB_NC}"
    echo "  db:     ${DB_IMAGE}:${DB_IMAGE_TAG} on internal compose network (data: /var/lib/type-any-language/postgres)"
    echo "          db image 的 entrypoint 自动跑 migrations + import content"
}

cmd_stop() {
    require_docker
    info "停止生产容器..."
    compose down
    ok "服务已停止"
}

cmd_restart() {
    # Pure action — no preflight. All checks live in doctor.sh
    # (single source of truth). ops/publish/deploy-prod.sh runs doctor after
    # this script; running lifecycle.sh directly is for ad-hoc reloads
    # when you already know the host is ready.
    info "重启容器(重新加载 image + env)..."

    local backend_before frontend_before db_before
    local backend_after frontend_after db_after
    backend_before=$(compose images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_before=$(compose images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)
    db_before=$(compose images -q "${DB_IMAGE}:${DB_IMAGE_TAG}" 2>/dev/null || true)

    # Recreate ALL 3 services (not just backend). With Layer 3, the
    # db image's entrypoint auto-applies migrations + imports content on
    # start — so recreating db is how new schema / content gets applied.
    # We also recreate frontend so new image tags take effect.
    # --no-build: PULL the new tags from ${DOCKER_REGISTRY} (GHCR) instead
    # of building locally.
    # --parallel=1: serialize image pulls (see cmd_start for the why).
    # Pre-pull each image up front with || true so a referrer-timeout
    # doesn't fail the whole compose up — the image itself is already
    # pulled by the time we get to `up -d`, so compose sees it locally
    # and skips the pull-with-attestation step. The 3 custom images
    # come from ${DOCKER_REGISTRY} which is set from
    # $vars.DOCKER_REGISTRY in the deploy-prod workflow. nginx is the
    # host's system nginx (see ops/cvm/nginx/site.conf + bootstrap.sh
    # step_nginx_site_link) — not pulled from any registry here.
    info "pre-pulling 3 images individually (tolerate referrer failures)..."
    for img in \
      "${DB_IMAGE}:${DB_IMAGE_TAG}" \
      "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" \
      "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    do
      target="${DOCKER_REGISTRY}/${img}"
      # Pull without sudo: the script runs as the `deploy` user (set up
      # by bootstrap-prod), which is in the `docker` group (see
      # bootstrap-prod.yml:134-139). NOPASSWD sudoers only covers
      # /bin/mkdir + /bin/chown (per bootstrap-prod.yml:107), so
      # `sudo docker …` would prompt for a password and fail in a
      # non-interactive SSH session.
      docker pull "$target" || warn "  $target pull finished with non-zero (likely referrer-timeout); proceeding if image is locally present"
    done
    echo ''

    # Tear down whatever is currently running BEFORE we try to bring
    # the new set up. `up -d --force-recreate` alone won't release
    # host port bindings that an old container is still holding in a
    # half-torn-down state — and a stale nginx container (e.g. left
    # over from a cancelled previous deploy) will keep host port 80
    # occupied so the new nginx fails to start. `down` is the only
    # way to force-release host ports cleanly; it tears down the
    # whole stack but compose reuses image layers so it's fast
    # (typically <2s) and the bind-mounted /var/lib/.../postgres
    # survives untouched.
    info "tearing down any running containers (releases host ports)..."
    compose down --remove-orphans || true
    sleep 2

    compose --parallel=1 up -d --no-deps --no-build db backend frontend

    backend_after=$(compose images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    frontend_after=$(compose images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)
    db_after=$(compose images -q "${DB_IMAGE}:${DB_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$backend_before" ] && [ "$backend_before" != "$backend_after" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  重 build 走 CI: .github/workflows/release-build.yml"
    fi
    if [ -n "$frontend_before" ] && [ "$frontend_before" != "$frontend_after" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  重 build 走 CI: .github/workflows/release-build.yml"
    fi
    if [ -n "$db_before" ] && [ "$db_before" != "$db_after" ]; then
        warn "$DB_IMAGE image ID 变化了 — 你是改了 Dockerfile?"
        warn "  重 build 走 CI: .github/workflows/release-build.yml"
    fi

    ok "服务已重启"
}

cmd_reload() { cmd_restart "$@"; }

usage() {
    cat <<EOF
用法: ./ops/cvm/lifecycle.sh <command>

命令:
  start            启动生产容器(db + backend + frontend)
  stop             停止生产容器
  restart|reload   recreate + 重读 env (≈5s, 不重 build image)
                   db 容器也 recreate —— 新 image 的 entrypoint 会自动
                   apply migrations + import content。

  (nginx 是宿主机 apt 装的系统 nginx,不在 compose 里,
   改配置走 ./ops/cvm/nginx/install.sh)

典型工作流:
  # 日常 reload(改了 config / env,没改 image)
  ALLOWED_ORIGINS=https://my.domain ./ops/cvm/lifecycle.sh restart

  # 发新版本:走 GH Actions(release-build.yml → publish-prod.yml),
  # 由 ops/publish/deploy-prod.sh 远程执行 make prod-restart + make prod-doctor
  make prod-restart && make prod-doctor

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./ops/cvm/lifecycle.sh start
  IMAGE_TAG=v0.5.0 ./ops/cvm/lifecycle.sh start
EOF
}

case "${1:-}" in
    start)             cmd_start "$@" ;;
    stop)              cmd_stop "$@" ;;
    restart|reload)    cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
