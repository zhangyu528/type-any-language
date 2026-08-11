#!/usr/bin/env bash
#
# ops/cvm/lifecycle.sh — start / stop / restart for the prod CVM.
#
# Subcommands:
#   start             compose up -d --no-build (pulls from registry)
#   stop              compose down (data persists in bind-mount)
#   restart           recreate all 3 services (db entrypoint re-applies
#                     migrations + content). Use after a new IMAGE_TAG.
#
# All image tags resolved by setup_prod_host_env (in ops/lib.sh) from
# IMAGE_TAG env, which publish-prod forwards from the git tag.
# RUN host never builds — --no-build ensures compose only pulls.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

# ─── subcommand: start ────────────────────────────────────────────────────
cmd_start() {
    info "启动生产容器 (db + backend + frontend)..."
    # --parallel=1: serialize image pulls. Default (-1, unlimited) fans out
    # one stream per service in parallel; on a CVM with rate-limited egress
    # to GHCR this saturates the per-IP concurrent connection cap and each
    # stream crawls at ~16-75 KB/s — 3 streams then never finish within
    # the 1800s command_timeout. Serializing finishes in minutes.
    # --no-build: RUN host pulls, never builds.
    compose --parallel=1 up -d --no-build
    ok "服务已启动"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost${_LIB_NC}"
    echo -e "  API:    ${_LIB_BLUE}http://localhost/api/docs${_LIB_NC}"
    echo "  db:     ${DB_IMAGE}:${DB_IMAGE_TAG} (data: /var/lib/type-any-language/postgres)"
}

# ─── subcommand: stop ─────────────────────────────────────────────────────
cmd_stop() {
    require_docker
    info "停止生产容器..."
    compose down
    ok "服务已停止"
}

# ─── subcommand: restart ──────────────────────────────────────────────────
# 4 phases: pre-pull (tolerate referrer-timeouts) → tear down (release
# host ports) → recreate → sanity-check image IDs. Helper functions are
# below; this function is just the orchestration.

cmd_restart() {
    info "重启容器(重新加载 image + env)..."

    local before_ids
    before_ids="$(capture_image_ids)"

    pre_pull_images
    tear_down_containers
    recreate_containers

    local after_ids
    after_ids="$(capture_image_ids)"
    report_image_id_changes "$before_ids" "$after_ids"

    ok "服务已重启"
}

# capture_image_ids — echo "backend_id frontend_id db_id" for the 3
# images (resolved by setup_prod_host_env). Empty string if image
# missing locally. Used before/after restart to detect a local build
# that drifted from the registry version (rare; bootstrap doesn't
# build, but operators sometimes do).
capture_image_ids() {
    local b f d
    b="$(compose images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)"
    f="$(compose images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)"
    d="$(compose images -q "${DB_IMAGE}:${DB_IMAGE_TAG}" 2>/dev/null || true)"
    printf '%s %s %s\n' "$b" "$f" "$d"
}

# pre_pull_images — pull each of the 3 registry images individually with
# `|| true`. Tolerates referrer-attestation timeouts that fail `compose
# pull` mid-stream; if the image is already present locally, the warning
# is harmless and we proceed.
pre_pull_images() {
    info "pre-pulling 3 images individually (tolerate referrer failures)..."
    local img target
    for img in \
      "${DB_IMAGE}:${DB_IMAGE_TAG}" \
      "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" \
      "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    do
        target="${DOCKER_REGISTRY}/${img}"
        docker pull "$target" || warn "  $target pull finished with non-zero (likely referrer-timeout); proceeding if image is locally present"
    done
    echo ''
}

# tear_down_containers — compose down + sleep. `up -d --force-recreate`
# alone won't release host port bindings that an old container is still
# holding in a half-torn-down state (e.g. a stale nginx from a cancelled
# previous deploy keeping host port 80 occupied). `down` is the only
# way to force-release host ports cleanly.
tear_down_containers() {
    info "tearing down any running containers (releases host ports)..."
    compose down --remove-orphans || true
    sleep 2
}

# recreate_containers — bring up the 3 services with the freshly-pulled
# images. --no-deps because the compose file's dependency graph is just
# backend→db and frontend→backend, both already satisfied by db being
# started first in the same command. --no-build prevents any local
# build (we only pull).
recreate_containers() {
    compose --parallel=1 up -d --no-deps --no-build db backend frontend
}

# report_image_id_changes <before> <after> — both args are the
# "backend_id frontend_id db_id" tuple from capture_image_ids. Warns
# if any image ID differs, which would mean a local build drifted
# from the registry (operators sometimes do this for debugging — if
# so, the host is no longer running the released version).
report_image_id_changes() {
    local before="$1" after="$2"
    local b_before f_before d_before
    local b_after f_after d_after
    # shellcheck disable=SC2086 # word splitting is intentional
    set -- $before; b_before="$1"; f_before="$2"; d_before="$3"
    # shellcheck disable=SC2086
    set -- $after;  b_after="$1";  f_after="$2";  d_after="$3"
    local img
    for img in "backend:$BACKEND_IMAGE:$b_before:$b_after" \
               "frontend:$FRONTEND_IMAGE:$f_before:$f_after" \
               "db:$DB_IMAGE:$d_before:$d_after"; do
        IFS=: read -r label name before_id after_id <<< "$img"
        if [ -n "$before_id" ] && [ "$before_id" != "$after_id" ]; then
            warn "$name image ID 变化了($label) — 应该是本地 build 覆盖了 registry 版本,rebuild 走 CI: .github/workflows/release/build.yml"
        fi
    done
}

usage() {
    cat <<EOF
用法: ./ops/cvm/lifecycle.sh <command>

命令:
  start            启动生产容器(db + backend + frontend)
  stop             停止生产容器
  restart          recreate + 重读 env (≈5s, 不重 build image)
                   db 容器也 recreate —— 新 image 的 entrypoint 会自动
                   apply migrations + import content。

  -h | --help      显示本帮助。

环境覆盖:
  IMAGE_TAG=v0.5.0       ./ops/cvm/lifecycle.sh start   # 用固定 tag 不用 :latest
  ALLOWED_ORIGINS=...   ./ops/cvm/lifecycle.sh start   # backend CORS 配置

首次流程 / 日常流程 / 与 publish-prod workflow 的对接见 AGENTS.md。
EOF
}

case "${1:-}" in
    start)           cmd_start "$@" ;;
    stop)            cmd_stop "$@" ;;
    restart)         cmd_restart "$@" ;;
    -h|--help|help|"") usage ;;
    *)               { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac
