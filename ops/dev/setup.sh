#!/usr/bin/env bash
#
# ops/dev/setup.sh — first-time (or post-reset) bootstrap for dev.
#
# Walks the operator through the steps a fresh dev clone needs before
# `./lifecycle.sh start` will succeed. The dev db is a `postgres:15-alpine`
# container in the same compose file, managed by compose itself — no
# external docker postgres, no admin DSN, no ROLE/DB/GRANT dance. So setup
# is just:
#
#   1. Preflight: docker + compose must be present.
#   2. Build dev app images (skip if both already present locally).
#   3. Final summary + point at lifecycle.sh start.
#
# Subcommands:
#   (default) | setup    First-time dev setup. Builds dev app images
#                        and prints next-steps. Idempotent — re-running
#                        on a working setup short-circuits any work
#                        that's already done.
#
# Does NOT start containers, does NOT push to a registry, does NOT touch
# any cloud infrastructure.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_setup() {
    info "=== dev environment setup ==="
    echo ""

    # 1. Preflight — print-and-stop on failure so the operator can see
    #    every missing prerequisite in one go.
    local preflight_ok=1
    if check_docker_installed; then
        ok "docker 已安装: $(docker --version 2>&1 | head -1)"
    else
        err "docker 未安装"; preflight_ok=0
    fi
    if [ $preflight_ok -eq 1 ] && check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行 (启动 Docker Desktop)"; preflight_ok=0
    fi
    if [ $preflight_ok -eq 1 ] && detect_compose_cmd 2>/dev/null; then
        ok "compose: $DOCKER_COMPOSE_CMD"
    else
        err "未找到 docker-compose / docker compose"; preflight_ok=0
    fi
    if [ $preflight_ok -eq 0 ]; then
        err "preflight 失败 — 修好上面 1-2 项后再跑 setup"
        return 1
    fi
    echo ""

    # 2. dev app images
    info "Step 1/1: dev app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: ops/dev/build_image.sh)"
    else
        info "  调 ops/dev/build_image.sh (git-state tag → ${BACKEND_IMAGE_TAG})..."
        echo ""
        if "$COMMON_DIR/build_image.sh"; then
            echo ""
            ok "  build done"
        else
            err "  build 失败 — 见上面的错误"
            return 1
        fi
    fi
    echo ""

    ok "=== setup 完成 ==="
    info "  下一步: ./ops/dev/lifecycle.sh start"
    info "  第一次 start 会自动:"
    info "    1. 拉 postgres:15-alpine image"
    info "    2. 起 db 服务,把 ./.dev/data/postgres 持久化"
    info "    3. 起 backend,entrypoint 自动 apply migrations(空 db → 全套 migration)"
    info "    4. 起 frontend"
    info "  之后访问:"
    info "    前端: http://localhost:3000"
    info "    后端: http://localhost:8000  (API 文档: /docs)"
    info "  内容导入(把 cms/content/* UPSERT 到 dev db):"
    info "    make dev-import-content   # 或 ./ops/dev/import_content.sh"
    info ""
    info "  想跑一次干净: stop → rm -rf ./.dev/data/postgres → start"
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (default) | setup    Preflight + build dev app images. Idempotent —
                      re-runs short-circuit work that's already done.

典型工作流(全新机器):
  ./ops/dev/setup.sh                # preflight + build dev images
  ./ops/dev/lifecycle.sh start     # 起 db + backend + frontend
  make dev-import-content          # 把 cms/content/ UPSERT 到 dev db
EOF
}

case "${1:-}" in
    ""|setup)               cmd_setup ;;
    -h|--help|help)         usage ;;
    *)                      { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac
