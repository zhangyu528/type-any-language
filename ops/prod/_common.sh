#!/bin/bash
#
# ops/prod/_common.sh — shared setup for prod scripts.
#
# Sourced by every script in ops/prod/ — it does the bootstrap
# that otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, secrets file writes,
# port warnings.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_prod_host_env must be called before any other helper.
#
# The runtime database is Tencent Cloud (TencentDB) Postgres — there is
# no `db` service in the compose file, and no `english_db_content` image
# to inspect or auto-pull. The DSN is read by the backend container from
# a host-side .secrets/database_url file (mounted via compose's
# `secrets:` block + DATABASE_URL_FILE), written by
# db/scripts/bootstrap_tencent.sh (called from ops/prod/setup.sh bootstrap
# with OPS_TIER=prod).

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Globals set by setup_prod_host_env ─────────────────────────────────────
SECRETS_DIR=".secrets"
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
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-pull on for backend + frontend images)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (auto-pull off, local-only mode)"
    fi
    # *_IMAGE_TAG resolve to per-segment VERSION files:
    #   BACKEND_IMAGE_TAG  ← backend/VERSION (gates both english_backend_dev + english_backend)
    #   FRONTEND_IMAGE_TAG ← frontend/VERSION (gates both frontend images)
    # No DB_IMAGE_TAG — the db is no longer a baked image, it's an external
    # TencentDB instance whose DSN lives in .secrets/database_url.
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

# ─── write_secrets ──────────────────────────────────────────────────────────
# Ensures .secrets/database_url exists. The cloud-db DSN is written
# exclusively by db/scripts/bootstrap_tencent.sh (called from
# ops/prod/setup.sh bootstrap with OPS_TIER=prod); this function is a
# *gate* that fails loudly if the file is missing — pointing the operator
# at the right subcommand. It does NOT generate or rewrite the DSN.
#
#   .secrets/database_url        (chmod 600) — cloud-db DSN, consumed
#                                              by compose's `secrets:`
#                                              block + backend's
#                                              DATABASE_URL_FILE.
#
# Idempotent: an existing .secrets/database_url is preserved (the cloud
# db's password + role are stable across restarts). To rotate, re-run
# ops/prod/setup.sh bootstrap.
write_secrets() {
    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    if [ ! -f "$DB_URL_FILE" ]; then
        err ".secrets/database_url 不存在 — 云 db 未配置"
        info "  → 运行 ops/prod/setup.sh bootstrap (一次性: 创建 ROLE/DB, 写 .secrets/database_url)"
        info "  → 或从已 bootstrap 过的同分支 prod 主机拷过来: scp other-prod:.secrets/database_url .secrets/"
        return 1
    fi
    chmod 600 "$DB_URL_FILE"
    info "复用现有 $(basename "$DB_URL_FILE")"
}

# ─── gate_preflight ────────────────────────────────────────────────────────
# Verifies prod host readiness before starting the app stack:
#   1. Docker is installed and the daemon is up.
#   2. Backend + frontend images exist locally (built or pulled).
#   3. .secrets/database_url is present (cloud db bootstrap done).
#   4. Port 80 not bound on the host.
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
    if [ ! -f "$DB_URL_FILE" ]; then
        err ".secrets/database_url 不存在 — 云 db 未配置"
        info "  → 运行 ops/prod/setup.sh bootstrap"
        exit 1
    fi
    warn_port_in_use 80 "nginx 端口 (宿主机 80)"
}

# ─── drift_check ───────────────────────────────────────────────────────────
# Compare running containers' type-any-language.app.version LABEL against
# the locally-resolved *_IMAGE_TAG. Warns on mismatch. Skipped silently
# if no containers are running.
#
# The db service is gone — backend is the lowest-running service in the
# new layout, so the "any container running?" gate keys off backend.
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q backend >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in backend frontend; do
        case "$svc" in
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
