#!/bin/bash
#
# ops/prod/_common.sh — shared setup for prod scripts.
#
# Sourced by every script in ops/prod/ — it does the bootstrap
# that otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, db label inspection, secrets
# file writes, registry auto-pull, port warnings.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_prod_host_env must be called before any other helper.

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Globals set by setup_prod_host_env ─────────────────────────────────────
SECRETS_DIR=".secrets"
PG_PASSWORD_FILE="${SECRETS_DIR}/postgres_password"
DB_URL_FILE="${SECRETS_DIR}/database_url"
COMPOSE_FILE="docker-compose.yml"
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"

# ─── setup_prod_host_env ───────────────────────────────────────────────────
setup_prod_host_env() {
    # DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
    # Empty means local-only mode (no auto-pull).
    resolve_docker_registry
    if [ -n "$DOCKER_REGISTRY" ]; then
        if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected, auto-pull off — 本地模式)"
        else
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-pull on for db image)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (auto-pull off, local-only mode)"
    fi
    DB_IMAGE="${DB_IMAGE:-english_db_content}"
    # All three *_IMAGE_TAG resolve from VERSION.prod (this is the prod host).
    resolve_image_tag DB_IMAGE_TAG       VERSION.prod
    resolve_image_tag BACKEND_IMAGE_TAG  VERSION.prod
    resolve_image_tag FRONTEND_IMAGE_TAG VERSION.prod
    warn_if_version_default "$BACKEND_IMAGE_TAG" VERSION.prod

    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
        DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
        BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    else
        DB_FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
        BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
        export DOCKER_REGISTRY=""
    fi
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE
}

# ─── inspect_db_image_labels ────────────────────────────────────────────────
inspect_db_image_labels() {
    if ! image_exists "$DB_FULL_IMAGE"; then
        return 1
    fi
    DB_USER="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.user" || echo "")"
    DB_NAME="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.name" || echo "")"
    DB_VERSION="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.version" || echo "")"
    DB_BAKED_AT="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.baked-at" || echo "")"
    export DB_USER DB_NAME DB_VERSION DB_BAKED_AT
    [ -n "$DB_USER" ] && [ -n "$DB_NAME" ]
}

# ─── write_secrets ──────────────────────────────────────────────────────────
write_secrets() {
    if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
        err "DB_USER / DB_NAME 未设置 — content-baked db image 的 label 缺失或不正确"
        return 1
    fi

    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    if [ -f "$PG_PASSWORD_FILE" ]; then
        POSTGRES_PASSWORD="$(cat "$PG_PASSWORD_FILE")"
        info "复用现有 $(basename "$PG_PASSWORD_FILE")"
    else
        POSTGRES_PASSWORD="$(gen_secret 24)"
        info "新生成 POSTGRES_PASSWORD → $(basename "$PG_PASSWORD_FILE")"
    fi
    printf '%s' "$POSTGRES_PASSWORD" > "$PG_PASSWORD_FILE"
    chmod 600 "$PG_PASSWORD_FILE"

    if command -v python3 &> /dev/null; then
        encoded_pw="$(DB_USER="$DB_USER" DB_NAME="$DB_NAME" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            python3 -c 'import os, urllib.parse; print("postgresql://%s:%s@db:5432/%s" % (urllib.parse.quote(os.environ["DB_USER"]), urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""), os.environ["DB_NAME"]))')"
    else
        encoded_pw="postgresql://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"
    fi
    printf '%s' "$encoded_pw" > "$DB_URL_FILE"
    chmod 600 "$DB_URL_FILE"
}

# ─── auto_pull_from_registry ────────────────────────────────────────────────
# Pull ONLY the content-baked db image (backend/frontend are built locally
# on the prod host). Same registry-detect guard as dev.
auto_pull_from_registry() {
    if [ -z "$DOCKER_REGISTRY" ]; then
        return 0
    fi
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 跳过 auto-pull)"
        return 0
    fi
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY — 拉取最新 baked db image..."
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" pull db; then
        err "pull 失败 — 检查 DOCKER_REGISTRY / 网络 / 凭据"
        exit 1
    fi
}

# ─── gate_preflight ────────────────────────────────────────────────────────
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建"
        info "  → 运行 ops/prod/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建"
        info "  → 运行 ops/prod/build_image.sh"
        exit 1
    fi
    if ! image_exists "$DB_FULL_IMAGE"; then
        err "content-baked db image $DB_FULL_IMAGE 未构建或未拉取"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  → 设置 DB_IMAGE_TAG 后由脚本拉取,或: docker pull $DB_FULL_IMAGE"
        else
            info "  → 运行 db/scripts/build.sh(可用 --tag v1.0.0 标记)"
        fi
        exit 1
    fi
    warn_port_in_use 80  "nginx 端口 (宿主机 80)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"
}

# ─── drift_check ───────────────────────────────────────────────────────────
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in db backend frontend; do
        case "$svc" in
            db)      expected="$DB_IMAGE_TAG" ;;
            backend) expected="$BACKEND_IMAGE_TAG" ;;
            frontend) expected="$FRONTEND_IMAGE_TAG" ;;
        esac
        cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
        if [ -z "$cid" ]; then
            continue
        fi
        actual="$(docker inspect "$cid" --format '{{ index .Config.Labels "type-any-language.app.version" }}' 2>/dev/null || echo "")"
        if [ -z "$actual" ]; then
            warn "  $svc: 无 type-any-language.app.version LABEL (image 旧?rebuild)"
        elif [ "$actual" != "$expected" ]; then
            warn "  $svc drift: running=$actual, expected=$expected — restart 拉新 image"
        else
            ok "  $svc drift OK (version=$actual)"
        fi
    done
}
