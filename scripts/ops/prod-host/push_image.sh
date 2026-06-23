#!/bin/bash
#
# prod-host/push_image.sh — push PROD backend + frontend images to $DOCKER_REGISTRY.
#
# Symmetric with scripts/ops/db/push_image.sh (CMS host pushes the db image;
# target hosts push their own backend/frontend images). Run this AFTER
# ./scripts/ops/prod-host/build_image.sh has produced the images locally.
# Push is a deliberate, separate step: you might build many times locally
# before you're ready to publish.
#
# Subcommands:
#   (no args)    Push with interactive confirmation prompt.
#   -y|--yes     Skip the confirmation prompt (CI / cron mode).
#   doctor       Pre-flight: DOCKER_REGISTRY set, docker running, login state,
#                local images exist.
#   -h|--help    Show usage.
#
# Exit codes:
#   0   success (or user cancelled the prompt)
#   1   prerequisite missing
#   2   docker push failed
#
# Configuration is read from the shell env (target hosts have no .env):
#   DOCKER_REGISTRY  namespace prefix  (REQUIRED — push is disabled when
#                                       empty; that's local-only mode).
#
# Pushes (tag = latest by default):
#   english_backend   → ${DOCKER_REGISTRY}/english_backend:latest
#   english_frontend  → ${DOCKER_REGISTRY}/english_frontend:latest
#
# The db image is NOT pushed here — CMS host's scripts/ops/db/push_image.sh
# is the source of truth for that image (it's content-baked, not built here).
#
# Examples:
#   export DOCKER_REGISTRY=docker.io/youruser
#   ./scripts/ops/prod-host/push_image.sh             # interactive
#   ./scripts/ops/prod-host/push_image.sh -y          # CI
#   ./scripts/ops/prod-host/push_image.sh doctor      # check prereqs
#
# Requires: shell + docker. NO python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"

DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"

COMPOSE_FILE="docker-compose.yml"
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"
# *_IMAGE_TAG default to the root ./VERSION file (resolved by lib.sh).
resolve_image_tag BACKEND_IMAGE_TAG
resolve_image_tag FRONTEND_IMAGE_TAG
warn_if_version_default "$BACKEND_IMAGE_TAG"

# Back-compat: the old single `TAG=...` knob. Only honored when the
# per-image vars are still at their default. To be removed once all
# callers migrate.
_VER_DEFAULT="$(read_version_file)"
if [ -n "${TAG:-}" ] && [ "$BACKEND_IMAGE_TAG" = "$_VER_DEFAULT" ]; then
    warn "TAG=... 已废弃 — 用 BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG"
    BACKEND_IMAGE_TAG="$TAG"
    FRONTEND_IMAGE_TAG="$TAG"
fi
unset _VER_DEFAULT

# ---------------------------------------------------------------------------
# doctor — pre-flight checks. Returns 0/1, doesn't push.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== prod push_image.sh pre-flight ==="
    echo ""

    if [ -z "$DOCKER_REGISTRY" ]; then
        err "DOCKER_REGISTRY 未设置 — push 需要 registry"
        info "  → export DOCKER_REGISTRY=docker.io/youruser"
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

    # docker info prints "Username: <u>" when logged in. Best-effort probe.
    if docker info 2>/dev/null | grep -q "Username:"; then
        ok "docker 已登录"
    else
        warn "未检测到 docker login — push 可能被 registry 拒绝"
        info "  → docker login $DOCKER_REGISTRY"
    fi

    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "本地 image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 不存在"
        info "  → 先跑 ./scripts/ops/prod-host/build_image.sh"
        ok=0
    else
        ok "本地 image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 存在"
    fi

    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "本地 image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 不存在"
        info "  → 先跑 ./scripts/ops/prod-host/build_image.sh"
        ok=0
    else
        ok "本地 image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 存在"
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
        info "  → export DOCKER_REGISTRY=docker.io/youruser"
        exit 1
    fi

    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "本地 image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 不存在"
        info "  → 先跑 ./scripts/ops/prod-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "本地 image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 不存在"
        info "  → 先跑 ./scripts/ops/prod-host/build_image.sh"
        exit 1
    fi

    local backend_remote="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    local frontend_remote="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"

    echo ""
    info "Will push:"
    info "  $BACKEND_IMAGE  →  $backend_remote"
    info "  $FRONTEND_IMAGE →  $frontend_remote"
    info ""
    info "  (db image 由 CMS 主机 ./scripts/ops/db/push_image.sh 推)"

    # Brief metadata block.
    local backend_id frontend_id
    backend_id="$(docker inspect "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" --format '{{.Id}}' 2>/dev/null)"
    frontend_id="$(docker inspect "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" --format '{{.Id}}' 2>/dev/null)"
    info ""
    info "  backend  id=${backend_id}"
    info "  frontend id=${frontend_id}"
    echo ""

    if [ "$skip_confirm" = false ]; then
        read -p "Push to $DOCKER_REGISTRY? [y/N] " ans
        case "$ans" in
            [Yy]|[Yy][Ee][Ss]) ;;
            *) info "已取消"; exit 0 ;;
        esac
    fi

    echo ""
    info "Tagging..."
    docker tag "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" "$backend_remote"
    docker tag "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" "$frontend_remote"

    info "Pushing backend..."
    if ! docker push "$backend_remote"; then
        err "backend push 失败"
        info "  → 检查 docker login 状态、网络、registry quota"
        exit 2
    fi

    info "Pushing frontend..."
    if ! docker push "$frontend_remote"; then
        err "frontend push 失败"
        info "  → 检查 docker login 状态、网络、registry quota"
        exit 2
    fi

    echo ""
    ok "Pushed: $backend_remote"
    ok "Pushed: $frontend_remote"

    echo ""
    info "下一步:"
    info "  其他目标机 export DOCKER_REGISTRY=$DOCKER_REGISTRY && ./scripts/ops/prod-host/run.sh start"
    info "  (run.sh 会自动 docker pull 新 image)"
}

usage() {
    cat <<EOF
用法: $0 [command]

命令:
  (无参数)         push (带确认提示)
  -y | --yes       push (跳过确认, CI 模式)
  doctor           前置检查 (registry / docker / login / 本地 image)
  -h | --help      显示本帮助

配置 (shell env):
  DOCKER_REGISTRY         registry 命名空间 (REQUIRED for push)
  BACKEND_IMAGE_TAG       backend  image tag (默认: 根目录 ./VERSION)
  FRONTEND_IMAGE_TAG      frontend image tag (默认: 根目录 ./VERSION)
  IMAGE_TAG               通用 tag 覆盖 (CI 用，一次性给所有 image 设同 tag)
  TAG                     [已废弃] 用 BACKEND_IMAGE_TAG / FRONTEND_IMAGE_TAG

示例:
  export DOCKER_REGISTRY=docker.io/youruser
  ./scripts/ops/prod-host/build_image.sh && \\
    ./scripts/ops/prod-host/push_image.sh         # 交互
  ./scripts/ops/prod-host/push_image.sh -y        # CI
  ./scripts/ops/prod-host/push_image.sh doctor    # 前置检查

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