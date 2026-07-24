#!/bin/bash
#
# ops/prod/_common.sh — shared setup for prod scripts.
#
# Sourced by every script in ops/prod/ — does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, port warnings, drift check.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_prod_host_env must be called before any other helper.
#
# Runtime model:
#   Three services in prod compose, all on a single CVM:
#     db         — postgres:15-alpine, data bind-mounted to
#                  /var/lib/type-any-language/postgres. Password comes
#                  from .secrets/db_password (compose secrets: block).
#     backend    — FastAPI / uvicorn, no reload. Receives DATABASE_URL
#                  via compose environment.
#     nginx      — reverse proxy on :80.
#
#   DATABASE_URL is injected by compose via the `environment:` block
#   (no DATABASE_URL indirection — that's a docker postgres-era
#   artifact that's been retired). The backend's entrypoint.sh runs
#   migrations against the db service on every container start.

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Globals set by setup_prod_host_env ─────────────────────────────────────
SECRETS_DIR=".secrets"
DB_PASSWORD_FILE="${SECRETS_DIR}/db_password"
COMPOSE_FILE="docker-compose.yml"
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"
DB_IMAGE="postgres:15-alpine"

# ─── setup_prod_host_env ───────────────────────────────────────────────────
setup_prod_host_env() {
    # Detect compose command FIRST (populates $DOCKER_COMPOSE_CMD). Same
    # bug fix as ops/dev/_common.sh — without this, scripts that don't
    # go through gate_preflight (which transitively calls
    # detect_compose_cmd via require_docker) would have an empty
    # DOCKER_COMPOSE_CMD and silently fail.
    if ! detect_compose_cmd; then
        err "未找到 docker-compose / docker compose — 安装 Docker Desktop 或 docker-compose"
        exit 1
    fi

    # DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
    # Empty means local-only mode (no auto-pull).
    resolve_docker_registry
    if [ -n "$DOCKER_REGISTRY" ]; then
        if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected, auto-pull off — 本地模式)"
        else
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-pull on for backend + frontend images)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (auto-pull off, local-only mode)"
    fi
    # Prod image tags come from per-segment VERSION files:
    #   BACKEND_IMAGE_TAG  ← backend/VERSION  (semver)
    #   FRONTEND_IMAGE_TAG ← frontend/VERSION (semver)
    # Dev tags are content-hash-based and don't apply here.
    resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
    resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
    warn_if_version_default "$BACKEND_IMAGE_TAG" backend/VERSION

    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
        BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    else
        BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
        export DOCKER_REGISTRY=""
    fi
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE
}

# ─── gate_preflight ────────────────────────────────────────────────────────
# Verifies prod host readiness before starting the app stack:
#   1. Docker is installed and the daemon is up.
#   2. Backend + frontend images exist locally (built or pulled).
#   3. .secrets/db_password exists (db service needs it on first up).
#   4. /var/lib/type-any-language/postgres dir exists (created with
#      correct ownership on first deploy — see CLAUDE.md "Migrating
#      an existing host").
#   5. Port 80 not bound on the host.
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建/拉取"
        info "  → 运行 ops/prod/build_image.sh(或确认 registry 已推到该 tag)"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建/拉取"
        info "  → 运行 ops/prod/build_image.sh"
        exit 1
    fi
    if [ ! -f "$DB_PASSWORD_FILE" ]; then
        err ".secrets/db_password 不存在 — db 数据目录密码"
        info "  → 跑一次: openssl rand -hex 32 > .secrets/db_password && chmod 600 .secrets/db_password"
        exit 1
    fi
    chmod 600 "$DB_PASSWORD_FILE"
    if [ ! -d "/var/lib/type-any-language/postgres" ]; then
        warn "  注意: /var/lib/type-any-language/postgres 不存在 (第一次启动会创建,uid 999 = postgres)"
        info "  → sudo mkdir -p /var/lib/type-any-language/postgres"
        info "  → sudo chown 999:999 /var/lib/type-any-language/postgres"
    fi
    warn_port_in_use 80 "nginx 端口 (宿主机 80)"
}

# ─── drift_check ───────────────────────────────────────────────────────────
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q backend >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in backend frontend; do
        case "$svc" in
            backend)  expected="$BACKEND_IMAGE_TAG" ;;
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
