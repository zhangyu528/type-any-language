#!/usr/bin/env bash
#
# ops/prod/doctor.sh — pre-flight env check (read-only).
#
# Validates that everything ops/prod/{start,setup} need is in
# place. Does NOT modify anything on disk or call docker compose.
#
# Exit: 0 if all required checks pass; 1 otherwise.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_doctor() {
    local failed=0
    echo "=== Production environment check ==="
    echo ""

    if check_docker_installed; then
        ok "docker 已安装: $(docker --version 2>&1 | head -1)"
    else
        err "docker 未安装"; failed=1
    fi

    if check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行"; failed=1
    fi

    if detect_compose_cmd 2>/dev/null; then
        ok "compose: $DOCKER_COMPOSE_CMD"
    else
        err "未找到 docker-compose / docker compose"; failed=1
    fi

    if [ -f "$PG_PASSWORD_FILE" ]; then
        ok ".secrets/postgres_password 存在(密码稳定,db 不会重置)"
    else
        info ".secrets/postgres_password 缺失 — 下次 start 会现场生成"
    fi

    if check_docker_installed && check_docker_daemon_running; then
        if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
            ok "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 存在"
        else
            warn "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 缺失 → 运行 ops/prod/build_image.sh"
        fi
        if image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
            ok "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 存在"
        else
            warn "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 缺失 → 运行 ops/prod/build_image.sh"
        fi
        if image_exists "$DB_FULL_IMAGE"; then
            ok "content-baked db image $DB_FULL_IMAGE 存在"
            if inspect_db_image_labels; then
                ok "  db.user = $DB_USER"
                ok "  db.name = $DB_NAME"
                ok "  content.version = $DB_VERSION"
                ok "  content.baked-at = $DB_BAKED_AT"
            else
                warn "  content-baked db image 缺少 type-any-language.* labels — 重新 bake?"
            fi
        elif [ -n "$DOCKER_REGISTRY" ]; then
            warn "content-baked db image $DB_FULL_IMAGE 缺失 → ./ops/prod/lifecycle.sh restart"
        else
            warn "content-baked db image $DB_FULL_IMAGE 缺失 → db/scripts/build.sh"
        fi
    fi

    warn_port_in_use 80  "nginx 端口 (宿主机 80)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"

    if [ -z "$DOCKER_REGISTRY" ]; then
        warn "DOCKER_REGISTRY 未设置(auto-pull 会跳过;本地镜像必须已经构建)"
    else
        ok "DOCKER_REGISTRY=$DOCKER_REGISTRY"
    fi

    echo ""
    echo "--- drift check (running containers vs local VERSION) ---"
    drift_check

    echo ""
    if [ $failed -eq 0 ]; then
        ok "所有必需检查通过"
        return 0
    else
        err "部分必需检查未通过"
        return 1
    fi
}

cmd_doctor
