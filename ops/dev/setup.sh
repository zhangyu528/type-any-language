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
        info "  调 ops/dev/build_image.sh (content-hash tag → ${BACKEND_IMAGE_TAG})..."
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
    info "  setup 只做 image build(幂等轻量);db / 内容 是 start + import 的事"
    info ""
    info "  首次使用(全新机器 / 全新 db):"
    info "    1. ./ops/dev/lifecycle.sh start"
    info "       (会自动拉 postgres:15-alpine,起 db + backend + frontend + watch;"
    info "        若 db 是空的会 warn 提示跑 import)"
    info "    2. (CMS 主机) ./cms/run.sh                                # 产出 cms/content/"
    info "       rsync / git pull 到本机的 cms/content/ 目录"
    info "    3. ./ops/dev/import_content.sh                            # UPSERT + backfills,立即生效"
    info "       (自包含,会按需起 db;无需 restart backend)"
    info ""
    info "  日常 dev 改代码:"
    info "    ./ops/dev/lifecycle.sh start   # 第一次"
    info "    ./ops/dev/lifecycle.sh restart # 改完 / docker-compose.dev.yml / .env"
    info ""
    info "  日常 CMS 内容更新(同事改了 CMS):"
    info "    rsync cms/ 新内容到本机 cms/content/"
    info "    ./ops/dev/import_content.sh    # UPSERT,幂等"
    info ""
    info "  想完全干净重来:"
    info "    ./ops/dev/lifecycle.sh stop && rm -rf ./.dev/data/postgres && ./ops/dev/lifecycle.sh start"
    info "    # 然后重跑 import_content.sh"
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
