#!/usr/bin/env bash
#
# scripts/prod-host/setup.sh — first-time (or post-reset) bootstrap.
#
# Walks the operator through the image dependency chain so a fresh prod
# host is one command away from `./lifecycle.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (prod build_image.sh reads
#      DB_USER / DB_NAME from its OCI labels). Prod host NEVER bakes
#      db content itself — only pulls from registry or expects a
#      pre-loaded image.
#   3. prod app images: call scripts/prod-host/build_image.sh.
#      Skipped if both already present.
#   4. Final summary.
#
# Does NOT create .secrets/, start any containers, or push to a registry.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_setup() {
    info "=== prod environment setup ==="
    echo ""

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

    info "Step 1/2: content-baked db image ($DB_FULL_IMAGE)"
    if ! image_exists "$DB_FULL_IMAGE"; then
        warn "content-baked db image 不在本地"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  DOCKER_REGISTRY 已设,尝试 docker pull..."
            echo ""
            if docker pull "$DB_FULL_IMAGE"; then
                echo ""
                ok "  pull 成功"
            else
                err "  pull 失败 — 检查 registry / 网络 / 凭据"
                err "  或: 在 CMS 主机上先 push: db/scripts/push.sh -y"
                return 1
            fi
        else
            info "  prod 主机不 bake content,content-baked db image 必须从 CMS 主机过来:"
            info "    1. CMS 主机: cms/scripts/content.sh   # 数据管线(sync / sentences / audio)"
            info "    2. CMS 主机: db/scripts/build.sh       # 烤 db image"
            info "    3. CMS 主机: db/scripts/push.sh -y    # 推 registry"
            info "    4. 本机配置 REGISTRY / DOCKER_REGISTRY,再跑一次 ./scripts/prod-host/setup.sh"
            info "  (或: 手动 docker load/tar 把 content-baked db image 搬过来)"
            err "content-baked db image 缺失 — 完成上面的步骤后,再跑一次 setup"
            return 1
        fi
    fi
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        warn "  content-baked db image 缺 type-any-language.* label — 重新 bake"
        return 1
    fi
    echo ""

    info "Step 2/2: prod app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: scripts/prod-host/build_image.sh)"
    else
        info "  调 scripts/prod-host/build_image.sh..."
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
    info "  下一步: ./scripts/prod-host/lifecycle.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost  (经 nginx :80)"
    info "    API:  http://localhost/api/docs"
}

cmd_setup
