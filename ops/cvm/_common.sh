#!/bin/bash
#
# ops/cvm/_common.sh — shared setup for CVM-side scripts.
#
# Sourced by every script in ops/cvm/ — does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, compose invocation,
# port warnings, drift check.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_prod_host_env must be called before any other helper.
#   - ALWAYS invoke compose through the compose() wrapper below, never
#     through a bare $DOCKER_COMPOSE_CMD. See the wrapper's comment for
#     why --project-directory is non-negotiable.
#
# Runtime model:
#   Three containerised services, all on a single CVM:
#     db         — english_db (custom image), data bind-mounted to
#                  /var/lib/type-any-language/postgres. Password comes
#                  from .secrets/db_password (compose secrets: block).
#                  Its entrypoint applies migrations + imports content
#                  on every container start.
#     backend    — FastAPI / uvicorn, no reload. Assembles DATABASE_URL
#                  at boot from /run/secrets/db_password.
#     frontend   — Next.js standalone server on :3000.
#
#   nginx is NOT a compose service — it is the host's apt-installed
#   system nginx, configured from ops/cvm/nginx/site.conf and installed
#   by ops/cvm/nginx/install.sh (called from bootstrap.sh).

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Globals set by setup_prod_host_env ─────────────────────────────────────
SECRETS_DIR=".secrets"
DB_PASSWORD_FILE="${SECRETS_DIR}/db_password"
# Absolute path — the compose file lives in a subfolder, so a bare
# relative name would resolve against $PWD and break the moment a
# caller runs from anywhere other than the repo root.
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
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
    # Prod image tags come from the IMAGE_TAG env (set by deploy-prod from
    # the git tag). If IMAGE_TAG is unset, resolve_image_tag falls back to
    # the `latest` tag that release-build.yml publishes for every version
    # tag — so a host with no explicit pin still pulls a concrete image.
    # All 3 images (db + backend + frontend) share the same tag.
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

# ─── compose ───────────────────────────────────────────────────────────────
# The ONLY sanctioned way to call docker compose from ops/cvm/.
#
# The compose file (docker-compose.yml) lives at the repo root, so its
# relative paths (./secrets/db_password, ./backend, ./frontend, ./db/...)
# resolve naturally against the compose file own directory. --project-directory
# is still pinned (and useful) only for the project-name stability: compose
# derives the project name from the working directory basename unless told
# otherwise; without --project-name + --project-directory, the same script
# invoked from different PWDs would spin up different compose projects (and
# thus different container / network names).
compose() {
    $DOCKER_COMPOSE_CMD \
        --project-directory "$PROJECT_DIR" \
        --project-name "${COMPOSE_PROJECT_NAME:-type-any-language}" \
        -f "$COMPOSE_FILE" \
        "$@"
}


# --- sudo_run_or_manual ----------------------------------------------
# sudo_run_or_manual <cmd> [args...]
# Run 'sudo -n <cmd> [args...]' non-interactively. On failure (sudo missing,
# or the command rejected by NOPASSWD sudoers), print a self-run hint with
# the same command and return 1. Used by bootstrap.sh for root-bound prep
# steps (mkdir / chown); the operator re-runs the same command interactively
# if non-interactive sudo is not yet wired up.
sudo_run_or_manual() {
    if command -v sudo >/dev/null 2>&1 && sudo -n "$@"; then
        return 0
    fi
    if command -v sudo >/dev/null 2>&1; then
        err "  sudo 失败 (非交互)"
        err "  自己跑: sudo $*"
    else
        err "  sudo 不存在"
        err "  自己跑(以 root 身份): $*"
    fi
    return 1
}

# ─── drift_check ───────────────────────────────────────────────────────────
# Note: `gate_preflight` was removed in the 2026-08-04 refactor.
# All pre-flight checks now live in ops/cvm/doctor.sh (single source
# of truth). lifecycle.sh is pure action (no embedded checks); the CI
# deploy script (ops/publish/deploy-prod.sh) runs doctor after the restart.
# Run `make prod-doctor` standalone to check current state at any time.
# Compares each running container's image LABEL (`type-any-language.app.version`)
# against the resolved image tag. Mismatch means compose has been
# started with a different tag than the running image — restart to
# pull the new one.
drift_check() {
    if ! compose ps -q backend >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in db backend frontend; do
        case "$svc" in
            db)       expected="$DB_IMAGE_TAG" ;;
            backend)  expected="$BACKEND_IMAGE_TAG" ;;
            frontend) expected="$FRONTEND_IMAGE_TAG" ;;
        esac
        cid="$(compose ps -q "$svc" 2>/dev/null | head -1)"
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
