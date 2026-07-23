#!/bin/bash
#
# ops/build.sh — build all docker images locally, no push.
#
# Build-only counterpart to ops/release.sh. It orchestrates the
# existing per-stream build scripts so an operator can produce a complete,
# locally-runnable set of images in one command:
#
#   - dev app images   (english_backend_dev + english_frontend_dev)
#   - prod app images  (english_backend + english_frontend)
#
# The runtime database is TencentDB — there is no db image in the
# build pipeline. Content goes straight from cms/content/ into the
# cloud db via db/scripts/import_staging.sh on the CMS host (a
# separate step from this build script).
#
# Pushing is intentionally NOT handled here — use ops/release.sh for
# that. This script is for the "build everything so I can run/test it
# locally" workflow: a single-machine CMS+dev+prod setup, or just
# "rebuild after a code change".
#
# Subcommands:
#   (default) | all    Build dev + prod (the typical full local build).
#   dev                Build dev backend+frontend only.
#   prod               Build prod backend+frontend only.
#   -h | help          Show usage.
#
# Image tags follow the standard chain (each inner build script does its
# own resolution via lib.sh → resolve_image_tag):
#
#   per-image env (BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG)
#   > IMAGE_TAG                       # unified override for one-off builds
#   > backend/VERSION                  # backend stream (dev + prod tags)
#   > frontend/VERSION                 # frontend stream (dev + prod tags)
#   > v0.0.0                           # last-resort default (will warn once)
#
# Override all tags at once:
#
#   IMAGE_TAG=v1.2.3 ./ops/build.sh all
#
# Requires: shell + docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

require_docker

# Per-image env vars (BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG)
# propagate automatically because they're already in the environment.
# IMAGE_TAG is the unified override — export it so every inner resolve_image_tag
# call picks it up consistently.
if [ -n "${IMAGE_TAG:-}" ]; then
    export IMAGE_TAG
fi

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (default) | all   Build dev + prod (完整本地 build)
  dev               Build dev 应用镜像 (english_backend_dev + english_frontend_dev)
  prod              Build prod 应用镜像 (english_backend + english_frontend)
  -h | help         显示帮助

不负责 push — 想推到 registry 请用 ops/release.sh。

Image tag 解析(每个 inner build 自己 resolve, 见 lib.sh → resolve_image_tag):
  per-image env (BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG)
  > IMAGE_TAG                       (统一覆盖)
  > backend/VERSION / frontend/VERSION    (per-segment, 单文件同时管 dev+prod)
  > v0.0.0                          (缺省)

示例:
  $0                          # 默认: dev + prod
  $0 all                      # 同上
  $0 dev                      # 只 dev 流
  $0 prod                     # 只 prod 流
  IMAGE_TAG=v0.3.0 $0 all     # 一次性覆盖所有 tag

架构前提:
  - 不动 db — runtime db 是 TencentDB,没有 image 要 build。Content 用
    db/scripts/import_staging.sh 直接 UPSERT 到云 db(在 CMS 主机上跑,
    跟本脚本独立)。
  - 多机部署: 各自机器跑各自的 inner build 脚本即可,build.sh 主要方便
    单机 CMS+dev+prod 一把梭。
EOF
}

# run_step <description> <command...> — invoke a sub-script; propagate failure.
run_step() {
    local desc="$1"; shift
    info "[step] $desc"
    if ! "$@"; then
        err "[step] 失败: $desc"
        err "  command: $*"
        exit 1
    fi
    ok "[step] ok: $desc"
}

cmd_all() {
    info "=== build all (dev + prod) ==="
    echo ""

    run_step "build dev backend + frontend" \
        ./ops/dev/build_image.sh
    echo ""

    run_step "build prod backend + frontend" \
        ./ops/prod/build_image.sh
    echo ""

    ok "build all done."
    info "  → 启动 dev:  ./ops/dev/lifecycle.sh start"
    info "  → 启动 prod: ./ops/prod/lifecycle.sh start"
}

cmd_dev() {
    info "=== build dev only ==="
    run_step "build dev backend + frontend" \
        ./ops/dev/build_image.sh
    echo ""
    ok "build dev done."
    info "  → 启动: ./ops/dev/lifecycle.sh start"
}

cmd_prod() {
    info "=== build prod only ==="
    run_step "build prod backend + frontend" \
        ./ops/prod/build_image.sh
    echo ""
    ok "build prod done."
    info "  → 启动: ./ops/prod/lifecycle.sh start"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
case "${1:-}" in
    all|"")         cmd_all ;;
    dev)            cmd_dev ;;
    prod)           cmd_prod ;;
    -h|--help|help) usage ;;
    *)              usage; err "未知命令: $1"; exit 1 ;;
esac