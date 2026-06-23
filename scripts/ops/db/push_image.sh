#!/bin/bash
#
# cms/push_image.sh — push the baked db image to $DOCKER_REGISTRY.
#
# Run this AFTER ./scripts/ops/db/bake_image.sh has produced the image
# locally. Push is a deliberate, separate step: you might bake many
# times locally before you're ready to publish.
#
# Subcommands:
#   (no args)    Push with interactive confirmation prompt.
#   -y|--yes     Skip the confirmation prompt (CI / cron mode).
#   doctor       Pre-flight: .env.db has DOCKER_REGISTRY, image exists,
#                docker daemon running, login state.
#   -h|--help    Show usage.
#
# Exit codes:
#   0   success (or user cancelled the prompt)
#   1   prerequisite missing
#   2   docker push failed
#
# Configuration is read from .env.db:
#   DB_IMAGE         image name        (default: english_db_content)
#   DB_IMAGE_TAG     image tag         (default: latest)
#   DOCKER_REGISTRY  namespace prefix  (REQUIRED — push is disabled when
#                                       empty; that's local-only mode).
#
# Examples:
#   ./scripts/ops/db/push_image.sh             # interactive
#   ./scripts/ops/db/push_image.sh -y          # CI
#   ./scripts/ops/db/push_image.sh doctor      # check prereqs
#
# Requires: shell + docker. NO python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"

# Load .env.db
if [ -f .env.db ]; then
    set -a; . ./.env.db; set +a
else
    err ".env.db 不存在 — 跑 ./scripts/ops/db/env.sh 先引导"
    exit 1
fi

DB_IMAGE="${DB_IMAGE:-english_db_content}"
DB_IMAGE_TAG="${DB_IMAGE_TAG:-latest}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"

LOCAL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
if [ -n "$DOCKER_REGISTRY" ]; then
    REMOTE_IMAGE="${DOCKER_REGISTRY}/${LOCAL_IMAGE}"
else
    REMOTE_IMAGE=""
fi

# ---------------------------------------------------------------------------
# doctor — pre-flight checks. Returns 0/1, doesn't push.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== push_image.sh pre-flight ==="
    echo ""

    if [ -z "$DOCKER_REGISTRY" ]; then
        err "DOCKER_REGISTRY 未设置 — push 需要 registry"
        info "  → ./scripts/ops/db/env.sh update DOCKER_REGISTRY=docker.io/youruser"
        ok=0
    else
        ok "DOCKER_REGISTRY=$DOCKER_REGISTRY"
    fi

    if ! check_docker_installed; then
        err "docker 未安装"
        ok=0
    else
        ok "docker 已安装"
    fi

    if ! check_docker_daemon_running; then
        err "docker daemon 未运行"
        ok=0
    else
        ok "docker daemon 在跑"
    fi

    if ! image_exists "$LOCAL_IMAGE"; then
        err "本地 image $LOCAL_IMAGE 不存在"
        info "  → 先跑 ./scripts/ops/db/bake_image.sh"
        ok=0
    else
        ok "本地 image $LOCAL_IMAGE 存在"
        # Print the type-any-language.* labels so the operator can sanity-check.
        echo ""
        info "  type-any-language labels:"
        docker inspect "$LOCAL_IMAGE" \
            --format '{{range $k, $v := .Config.Labels}}{{if eq (index (split $k ".") 0) "type-any-language"}}    {{$k}}={{$v}}{{"\n"}}{{end}}' \
            2>/dev/null | sed 's/^/    /'
    fi

    echo ""
    if [ "$ok" = "1" ]; then
        ok "所有检查通过 — 可以 push"
        return 0
    else
        err "部分检查未通过"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# cmd_push — interactive push (or -y to skip the prompt).
# ---------------------------------------------------------------------------
cmd_push() {
    local skip_confirm=false
    while [ $# -gt 0 ]; do
        case "$1" in
            -y|--yes) skip_confirm=true; shift ;;
            *) err "未知参数: $1"; usage; exit 1 ;;
        esac
    done

    if [ -z "$DOCKER_REGISTRY" ]; then
        err "DOCKER_REGISTRY 未设置 — push 需要 registry"
        info "  → ./scripts/ops/db/env.sh update DOCKER_REGISTRY=docker.io/youruser"
        exit 1
    fi

    if ! image_exists "$LOCAL_IMAGE"; then
        err "本地 image $LOCAL_IMAGE 不存在"
        info "  → 先跑 ./scripts/ops/db/bake_image.sh"
        exit 1
    fi

    # What we're about to push — image id + key labels.
    echo ""
    info "Will push:"
    info "  local:  $LOCAL_IMAGE"
    info "  remote: $REMOTE_IMAGE"
    info ""

    # Brief metadata block.
    local img_id img_size
    img_id="$(docker inspect "$LOCAL_IMAGE" --format '{{.Id}}' 2>/dev/null)"
    img_size="$(docker inspect "$LOCAL_IMAGE" --format '{{.Size}}' 2>/dev/null)"
    info "  id=${img_id}"
    info "  size=${img_size} bytes"
    echo ""

    if [ "$skip_confirm" = false ]; then
        read -p "Push to $DOCKER_REGISTRY? [y/N] " ans
        case "$ans" in
            [Yy]|[Yy][Ee][Ss]) ;;
            *) info "已取消"; exit 0 ;;
        esac
    fi

    echo ""
    info "Pushing..."
    # Let docker push stream its own progress (--quiet is too quiet).
    if ! docker push "$REMOTE_IMAGE"; then
        err "docker push 失败"
        info "  → 检查 docker login 状态、网络、registry quota"
        exit 2
    fi

    echo ""
    ok "Pushed: $REMOTE_IMAGE"

    echo ""
    info "下一步:"
    info "  target 主机 ./scripts/{prod,dev}/run.sh restart"
    info "  (run.sh 会自动 docker pull 新 image 然后 force-recreate)"
}

usage() {
    cat <<EOF
用法: $0 [command]

命令:
  (无参数)         push (带确认提示)
  -y | --yes       push (跳过确认, CI 模式)
  doctor           前置检查 (registry / image / docker / login)
  -h | --help      显示本帮助

配置 (.env.db):
  DB_IMAGE         image 名字 (默认: english_db_content)
  DB_IMAGE_TAG     image tag  (默认: latest)
  DOCKER_REGISTRY  registry 命名空间 (REQUIRED for push)

示例:
  ./scripts/ops/db/push_image.sh            # 交互
  ./scripts/ops/db/push_image.sh -y         # CI
  ./scripts/ops/db/push_image.sh doctor     # 前置检查

退出码:
  0  成功 (或用户取消)
  1  前置条件缺失
  2  docker push 失败
EOF
}

case "${1:-}" in
    doctor)         cmd_doctor ;;
    -h|--help|help) usage ;;
    -y|--yes)       shift; cmd_push "$@" ;;
    "")             cmd_push ;;
    *)              usage; err "未知命令: $1"; exit 1 ;;
esac