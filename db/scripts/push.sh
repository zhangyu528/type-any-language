#!/bin/bash
#
# cms/db/scripts/push.sh — push the baked db image to $DOCKER_REGISTRY.
#
# Run this AFTER ./cms/scripts/db/scripts/build.sh has produced the image
# locally. Push is a deliberate, separate step: you might bake many
# times locally before you're ready to publish.
#
# Symmetric with ops/{dev,prod}-host/db/scripts/push.sh: all three
# push scripts read every config value (DOCKER_REGISTRY, DB_IMAGE,
# DB_IMAGE_TAG) from the shell env, NOT from cms/.env. cms/.env is the
# bake-time secret store (OpenAI/Tencent keys, postgres connection,
# etc.) and shouldn't bleed into push.
#
# Subcommands:
#   (no args)    Push with interactive confirmation prompt.
#   -y|--yes     Skip the confirmation prompt (CI / cron mode).
#   doctor       Pre-flight: DOCKER_REGISTRY set, image exists,
#                docker daemon running, login state.
#   -h|--help    Show usage.
#
# Exit codes:
#   0   success (or user cancelled the prompt)
#   1   prerequisite missing
#   2   docker push failed
#
# Configuration (ALL shell env; cms/.env is NOT loaded by this script):
#   DOCKER_REGISTRY  namespace prefix  (REQUIRED — push is disabled when
#                                      empty; that's local-only mode).
#                      Source precedence:
#                        1. shell env:   export DOCKER_REGISTRY=...
#                        2. REGISTRY file at repo root (committed shared config)
#                        3. auto-detect: detect_default_registry()
#                                        (docker.io/$USER or "")
#   DB_IMAGE         image name        (default: english_db_content,
#                                        shell env override)
#   DB_IMAGE_TAG     image tag         (default: VERSION.prod,
#                                        shell env override)
#
# Examples:
#   export DOCKER_REGISTRY=docker.io/youruser
#   ./cms/scripts/db/scripts/push.sh             # interactive
#   ./cms/scripts/db/scripts/push.sh -y          # CI
#   ./cms/scripts/db/scripts/push.sh doctor      # check prereqs
#
# Requires: shell + docker. NO python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../ops/lib.sh"

# NOTE: we deliberately do NOT load cms/.env here. Push is a separate
# concern from bake: cms/.env is the bake-time secret/config store
# (OpenAI/Tencent keys, postgres connection, etc.) and shouldn't bleed
# into push. The values that push DOES care about are all shell-env:
#   DB_IMAGE         image name (default: english_db_content)
#   DB_IMAGE_TAG     image tag  (default: root VERSION.prod)
#   DOCKER_REGISTRY  registry namespace (default: detect_default_registry())
# Bake pushes the image — push only needs to know its name + tag +
# where to send it. Nothing else.
DB_IMAGE="${DB_IMAGE:-english_db_content}"
resolve_image_tag DB_IMAGE_TAG VERSION.prod
warn_if_version_default "$DB_IMAGE_TAG" VERSION.prod
# DOCKER_REGISTRY is push-only concern. Symmetric with dev/prod db/scripts/push.sh.
# Chain: shell env > ./REGISTRY file > detect_default_registry().
resolve_docker_registry

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

    echo "=== db/scripts/push.sh pre-flight ==="
    echo ""

    if [ -z "$DOCKER_REGISTRY" ]; then
        err "DOCKER_REGISTRY 未设置 — push 需要 registry"
        info "  → export DOCKER_REGISTRY=docker.io/youruser"
        info "  → 或在仓库根的 REGISTRY 文件里设置 (commit 后全队共享)"
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
        info "  → 先跑 ./cms/scripts/db/scripts/build.sh"
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
        info "  → export DOCKER_REGISTRY=docker.io/youruser"
        info "  → 或在仓库根的 REGISTRY 文件里设置 (commit 后全队共享)"
        exit 1
    fi

    if ! image_exists "$LOCAL_IMAGE"; then
        err "本地 image $LOCAL_IMAGE 不存在"
        info "  → 先跑 ./cms/scripts/db/scripts/build.sh"
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
    info "  target 主机 ./ops/{prod,dev}/lifecycle.sh restart"
    info "  (lifecycle.sh 会自动 docker pull 新 image 然后 force-recreate)"
}

usage() {
    cat <<EOF
用法: $0 [command]

命令:
  (无参数)         push (带确认提示)
  -y | --yes       push (跳过确认, CI 模式)
  doctor           前置检查 (registry / image / docker / login)
  -h | --help      显示本帮助

配置:
  DOCKER_REGISTRY  registry 命名空间 (REQUIRED for push)
                   来源: shell env > ./REGISTRY 文件 > detect_default_registry()
                         export DOCKER_REGISTRY=docker.io/youruser
  DB_IMAGE         image 名字  (默认: english_db_content; shell env 覆盖)
  DB_IMAGE_TAG     image tag   (默认: VERSION.prod; shell env 覆盖)

示例:
  export DOCKER_REGISTRY=docker.io/youruser
  ./cms/scripts/db/scripts/push.sh            # 交互
  ./cms/scripts/db/scripts/push.sh -y         # CI
  ./cms/scripts/db/scripts/push.sh doctor     # 前置检查

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