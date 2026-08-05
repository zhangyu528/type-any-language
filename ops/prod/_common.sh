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
# Three image set, all tagged with the same VERSION (one publish = one release)
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"
DB_IMAGE="english_db"   # custom build (db/Dockerfile) — NOT postgres:15-alpine anymore

# ─── setup_prod_host_env ───────────────────────────────────────────────────
setup_prod_host_env() {
    # Detect compose command FIRST (populates $DOCKER_COMPOSE_CMD). Same
    # bug fix as ops/dev/_common.sh — without this, scripts that don't
    # transitively call detect_compose_cmd via require_docker would have
    # an empty DOCKER_COMPOSE_CMD and silently fail.
    if ! detect_compose_cmd; then
        err "未找到 docker-compose / docker compose — 安装 Docker Desktop 或 docker-compose"
        exit 1
    fi

    # DOCKER_REGISTRY is single source of truth: GitHub Variable.
    # resolve_docker_registry fails loud if it's not readable.
    if ! resolve_docker_registry; then
        err "DOCKER_REGISTRY 解析失败,prod 端必须有 registry 才能拉 3 个 image"
        info "  解决: gh auth login  +  配 GH repo Variable DOCKER_REGISTRY"
        exit 1
    fi
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY (source=${_DOCKER_REGISTRY_SOURCE:-github}, auto-pull on for all 3 prod images)"
    # Prod image tags come from per-segment VERSION files. With Layer 3,
    # all 3 images (db + backend + frontend) share the same tag — a publish
    # is a "release set" of 3 images at the same version.
    resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
    resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
    resolve_image_tag DB_IMAGE_TAG       db/VERSION
    warn_if_version_default "$BACKEND_IMAGE_TAG" backend/VERSION

    # DOCKER_REGISTRY is always from GH Variable (single source of truth).
    # No local-only mode (would require shell-env override, which we
    # removed in 2026-08-04). If you need a different registry for
    # testing, change the GH Variable, don't try to set it via shell.
    BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE DB_FULL_IMAGE
}

# ─── drift_check ───────────────────────────────────────────────────────────
# Note: `gate_preflight` was removed in the 2026-08-04 refactor.
# All pre-flight checks now live in ops/prod/doctor.sh (single source
# of truth). lifecycle.sh is pure action (no embedded checks); deploy.sh
# runs `doctor.sh` pre + post. Run `make prod-doctor` standalone to
# check current state at any time.
# Compares each running container's image LABEL (`type-any-language.app.version`)
# against the per-segment VERSION file. Mismatch means compose has been
# started with a different VERSION than the running image — restart to
# pull the new one.
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q backend >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in db backend frontend; do
        case "$svc" in
            db)       expected="$DB_IMAGE_TAG" ;;
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
