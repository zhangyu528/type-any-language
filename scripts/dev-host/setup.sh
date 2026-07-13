#!/usr/bin/env bash
#
# scripts/dev-host/setup.sh — first-time (or post-reset) bootstrap.
#
# Walks the operator through the image dependency chain so a fresh clone
# is one command away from `./lifecycle.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (build reads DB_USER / DB_NAME
#      from its OCI labels — a hard requirement, not a convenience).
#      If missing, try:
#        - DOCKER_REGISTRY set → docker pull
#        - cms/.env present (or scaffoldable via env.sh init, validated
#          by doctor) → single-host auto-bake (full CMS pipeline on this
#          host)
#   3. dev app images: call scripts/dev-host/build_image.sh (handles
#      both at once). Skipped if both already present.
#   4. Final summary.
#
# Does NOT create .secrets/, start any containers, or push to a registry.
# Re-run as many times as you want — nothing destructive.
#
# Counterpart to scripts/dev-host/{lifecycle,doctor,logs,migrate,watch}.sh.

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

    # 2. content-baked db image — must be present locally for the dev app build.
    info "Step 1/2: content-baked db image ($DB_FULL_IMAGE)"
    local got_image=0
    if image_exists "$DB_FULL_IMAGE"; then
        ok "  本地已有 $DB_FULL_IMAGE"
        got_image=1
    else
        warn "content-baked db image 不在本地"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  DOCKER_REGISTRY=$DOCKER_REGISTRY — 尝试 docker pull..."
            echo ""
            if docker pull "$DB_FULL_IMAGE"; then
                echo ""
                ok "  pull 成功"
                got_image=1
            else
                warn "  pull 失败 — fallback 到本地 auto-bake"
            fi
        fi
        if [ "$got_image" = "0" ]; then
            # cms/.env 缺失 → 先 scaffold (env.sh init 幂等,已存在会跳过)。
            CONTENT_ENV_FILE_PATH="$(resolve_content_env_file)"
            if [ ! -f "$CONTENT_ENV_FILE_PATH" ]; then
                info "  本机没有 $CONTENT_ENV_FILE_PATH — 先 scaffold 一个:"
                echo ""
                if ! "$PROJECT_DIR/cms/scripts/env.sh" init; then
                    err "  env.sh init 失败 — 检查 cms/.env.example.cms 是否存在"
                    return 1
                fi
                echo ""
                warn "  ↑ 上面只是 scaffold,secrets 还要手动填 (nano $CONTENT_ENV_FILE_PATH)"
                echo ""
            fi
            if ! "$PROJECT_DIR/cms/scripts/env.sh" doctor; then
                err "  $CONTENT_ENV_FILE_PATH 还差 key — 填好后重跑 setup"
                return 1
            fi
            info "  调 cms/scripts/full_bake.sh (source db + 内容 + 烘焙)..."
            echo ""
            if "$PROJECT_DIR/cms/scripts/full_bake.sh"; then
                echo ""
                ok "  自动 bake 完成"
                got_image=1
            else
                err "  自动 bake 失败 — 上面的错误说明哪步挂了"
                info "  手动排查:"
                info "    docker logs english_db          # 如果 source db 起不来"
                info "    ./cms/scripts/full_bake.sh doctor   # 内容管线 preflight"
                return 1
            fi
        fi
    fi
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        warn "  content-baked db image 缺 type-any-language.* label — 重新 bake"
        return 1
    fi
    echo ""

    # 3. dev app images
    info "Step 2/2: dev app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: scripts/dev-host/build_image.sh)"
    else
        info "  调 scripts/dev-host/build_image.sh..."
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

    # 4. Final summary
    ok "=== setup 完成 ==="
    info "  下一步: ./scripts/dev-host/lifecycle.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost:3000"
    info "    后端: http://localhost:8000  (API 文档: /docs)"
}

cmd_setup
