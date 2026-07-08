#!/bin/bash
#
# scripts/build.sh — build all docker images locally, no push.
#
# Build-only counterpart to scripts/release.sh. It orchestrates the
# existing per-stream build scripts so an operator can produce a complete,
# locally-runnable set of images in one command:
#
#   - content-baked db image         (content-baked, via scripts/ops/content/bake_image.sh)
#   - dev app images   (english_backend_dev + english_frontend_dev)
#   - prod app images  (english_backend + english_frontend)
#
# Pushing is intentionally NOT handled here — use scripts/release.sh for
# that. This script is for the "build everything so I can run/test it
# locally" workflow: a CMS host that bakes + locally runs dev, a single-
# machine CMS+dev+prod setup, or just "rebuild after a code change".
#
# Subcommands:
#   (default) | all    Build db + dev + prod (the typical full local build).
#   db                 Just bake the content-baked db image (CMS content pipeline output).
#   dev                Build dev backend+frontend (requires content-baked db image present).
#   prod               Build prod backend+frontend (requires content-baked db image present).
#   -h | help          Show usage.
#
# The dev / prod app builds each need the db image's OCI labels
# (DB_USER / DB_NAME) — that's why the db bake runs first under `all`.
# If you already have a content-baked db image at the right tag, just run `dev` / `prod`
# directly (or pull it from the registry with `docker pull`).
#
# Image tags follow the standard chain (each inner build script does its
# own resolution via lib.sh → resolve_image_tag):
#
#   per-image env (BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG / DB_IMAGE_TAG)
#   > IMAGE_TAG                  # unified override for one-off builds
#   > VERSION.dev / VERSION.prod # the project's two stream files
#   > v0.0.0                     # last-resort default (will warn once)
#
# Override all tags at once:
#
#   IMAGE_TAG=v1.2.3 ./scripts/build.sh all
#
# Requires: shell + docker (+ python + .env.db for the db bake).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

require_docker

# Per-image env vars (BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG / DB_IMAGE_TAG)
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
  (default) | all   Build db + dev + prod (完整本地 build)
  db                只 bake content-baked db image (CMS 内容流水线产物)
  dev               Build dev 应用镜像 (english_backend_dev + english_frontend_dev)
  prod              Build prod 应用镜像 (english_backend + english_frontend)
  -h | help         显示帮助

不负责 push — 想推到 registry 请用 scripts/release.sh。

Image tag 解析(每个 inner build 自己 resolve, 见 lib.sh → resolve_image_tag):
  per-image env (BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG / DB_IMAGE_TAG)
  > IMAGE_TAG                       (统一覆盖)
  > VERSION.dev / VERSION.prod      (仓库根)
  > v0.0.0                          (缺省)

示例:
  $0                          # 默认: db + dev + prod
  $0 all                      # 同上
  $0 dev                      # 只 dev 流 (假定 content-baked db image 已存在)
  $0 db                       # 只 bake db
  IMAGE_TAG=v0.3.0 $0 all     # 一次性覆盖所有 tag
  DB_IMAGE_TAG=v0.5.0 $0 all  # 只覆盖 db tag,dev/prod 走各自的 VERSION 文件

架构前提:
  - dev / prod 的 build_image.sh 需要 content-baked db image 的 OCI label (DB_USER / DB_NAME),
    所以 all / dev / prod 都假设 content-baked db image 已经在本地(或先跑过 db)。
  - db bake 需要 .env.db + 跑着 english_db 或 english_db_dev 容器。
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
    info "=== build all (db + dev + prod) ==="
    echo ""

    # db first — its OCI labels (DB_USER / DB_NAME) are needed by the
    # dev / prod build scripts' compose interpolation.
    run_step "bake content-baked db image (content-baked)" \
        ./scripts/ops/content/bake_image.sh
    echo ""

    run_step "build dev backend + frontend" \
        ./scripts/ops/dev-host/build_image.sh
    echo ""

    run_step "build prod backend + frontend" \
        ./scripts/ops/prod-host/build_image.sh
    echo ""

    ok "build all done."
    info "  → 启动 dev:  ./scripts/ops/dev-host/run.sh start"
    info "  → 启动 prod: ./scripts/ops/prod-host/run.sh start"
}

cmd_db() {
    info "=== build db only ==="
    run_step "bake content-baked db image (content-baked)" \
        ./scripts/ops/content/bake_image.sh
    echo ""
    ok "build db done."
}

cmd_dev() {
    info "=== build dev only ==="
    run_step "build dev backend + frontend" \
        ./scripts/ops/dev-host/build_image.sh
    echo ""
    ok "build dev done."
    info "  → 启动: ./scripts/ops/dev-host/run.sh start"
}

cmd_prod() {
    info "=== build prod only ==="
    run_step "build prod backend + frontend" \
        ./scripts/ops/prod-host/build_image.sh
    echo ""
    ok "build prod done."
    info "  → 启动: ./scripts/ops/prod-host/run.sh start"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
case "${1:-}" in
    all|"")         cmd_all ;;
    db)             cmd_db ;;
    dev)            cmd_dev ;;
    prod)           cmd_prod ;;
    -h|--help|help) usage ;;
    *)              usage; err "未知命令: $1"; exit 1 ;;
esac