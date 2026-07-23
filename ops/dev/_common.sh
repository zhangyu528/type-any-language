#!/bin/bash
#
# ops/dev/_common.sh — shared setup for the dev scripts.
#
# Sourced by every script in ops/dev/ — it does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, watch process lifecycle,
# port warnings.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_dev_host_env must be called before any other helper — it sets
#     all the *_IMAGE / *_FULL_IMAGE / *_IMAGE_TAG globals.
#
# Runtime model:
#   Three services in dev compose:
#     db         — postgres:15-alpine, data bind-mounted to .dev/data/postgres/
#     backend    — FastAPI / uvicorn --reload, ./backend bind-mounted
#     frontend   — Next.js dev server (HMR via compose watch)
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

# ─── Globals set by setup_dev_host_env ─────────────────────────────────────
COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"
DB_IMAGE="postgres:15-alpine"

# compose-watch background process. The frontend dev container doesn't
# use a bind mount anymore (see docker-compose.dev.yml `develop.watch`)
# — instead, `docker compose watch` runs as a long-lived process that
# syncs src/ + package files into the container. We auto-spawn it from
# start (nohup, detached) and kill it from stop. PID + log live at the
# repo root so they're easy to inspect / clean.
WATCH_PID_FILE=".compose-frontend-watch.pid"
WATCH_LOG_FILE=".compose-frontend-watch.log"

# ─── setup_dev_host_env — must be called once per script invocation ──────
setup_dev_host_env() {
    # DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
    # Empty means "local-only mode" — auto-pull from registry is disabled.
    # (Dev never pushes; it's only consulted for the rare case where a
    # teammate bootstrapped dev by pulling a shared dev image.)
    resolve_docker_registry
    if [ -n "$DOCKER_REGISTRY" ]; then
        if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 仅供可能需要时使用)"
        else
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (setup 一次性 bootstrap 拉取用,start 不再 auto-pull)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (local-only mode)"
    fi

    # Dev image tags now come from git state (branch + sha, optionally
    # -dirty), computed by ops/lib.sh::compute_dev_image_tag. VERSION
    # files (backend/VERSION, frontend/VERSION) gate PROD tags only —
    # `release.sh dev` does not touch VERSION files.
    #
    # Honor IMAGE_DEV_TAG override for CI / test fixtures.
    if [ -n "${IMAGE_DEV_TAG:-}" ]; then
        info "Using IMAGE_DEV_TAG override: $IMAGE_DEV_TAG"
        BACKEND_IMAGE_TAG="$IMAGE_DEV_TAG"
        FRONTEND_IMAGE_TAG="$IMAGE_DEV_TAG"
    else
        BACKEND_IMAGE_TAG="$(compute_dev_image_tag)"
        FRONTEND_IMAGE_TAG="$BACKEND_IMAGE_TAG"
        info "Dev image tag (from git state): $BACKEND_IMAGE_TAG"
    fi
    export BACKEND_IMAGE_TAG FRONTEND_IMAGE_TAG

    # Image full references (used in inspect / pull paths).
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
        BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    else
        BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
        # Force compose to use bare names too (its image: line re-uses
        # $DOCKER_REGISTRY for the prefix).
        export DOCKER_REGISTRY=""
    fi
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE
}

# ─── start_compose_watch / stop_compose_watch ──────────────────────────────
start_compose_watch() {
    if [ -f "$WATCH_PID_FILE" ]; then
        local existing_pid
        existing_pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || echo '')"
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
            info "compose watch 已在运行 (PID $existing_pid, log: $WATCH_LOG_FILE)"
            return 0
        fi
        rm -f "$WATCH_PID_FILE"
    fi

    info "后台启动 docker compose watch (frontend sync)..."
    nohup $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch \
        > "$WATCH_LOG_FILE" 2>&1 &
    local pid=$!
    disown "$pid" 2>/dev/null || true
    echo "$pid" > "$WATCH_PID_FILE"
    info "  compose watch PID=$pid → $WATCH_LOG_FILE"
}

stop_compose_watch() {
    if [ ! -f "$WATCH_PID_FILE" ]; then
        return 0
    fi
    local pid
    pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || echo '')"
    rm -f "$WATCH_PID_FILE"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
    fi
    info "compose watch 已停 (PID was $pid)"
}

cmd_watch_foreground() {
    require_docker
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch
}

# ─── gate_preflight ────────────────────────────────────────────────────────
# Verifies dev host readiness before starting the app stack:
#   1. Docker is installed and the daemon is up.
#   2. Backend + frontend images exist locally (built or pulled).
#   3. Postgres image is pullable (compose will pull on first up).
#   4. Port 3000/8000 not bound on the host.
#
# The db service is brought up by compose itself (it pulls the postgres
# image from Docker Hub, bind-mounts .dev/data/postgres, runs the
# healthcheck). gate_preflight doesn't pre-create the data dir —
# compose handles it.
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建"
        info "  → 运行 ops/dev/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建"
        info "  → 运行 ops/dev/build_image.sh"
        exit 1
    fi
    # First-boot hint: warn if the data dir is fresh (not existing).
    # Compose will create it via the volume mount; this hint just helps
    # the operator know what to expect.
    if [ ! -d "./.dev/data/postgres" ]; then
        info "  注意: ./.dev/data/postgres 不存在 — 第一次启动时 docker 会自动创建空 db"
    fi
    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
}

# ─── drift_check ──────────────────────────────────────────────────────────
# Compare running containers' type-any-language.app.dev-tag / version LABEL
# against the locally-resolved *_IMAGE_TAG. Warns on mismatch. Skipped
# silently if no containers are running.
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
            ok "  $svc drift OK (tag=$actual)"
        fi
    done
}
