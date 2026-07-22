#!/bin/bash
#
# ops/dev/_common.sh — shared setup for the dev scripts.
#
# Sourced by every script in ops/dev/ — it does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single source
# of truth for: image tag resolution, secrets file writes, watch process
# lifecycle, port warnings.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_dev_host_env must be called before any other helper — it sets
#     all the *_IMAGE / *_FULL_IMAGE / *_IMAGE_TAG globals.
#
# The runtime database is Tencent Cloud (TencentDB) Postgres — there is
# no `db` service in the compose file, and no `english_db_content` image
# to inspect. The DSN is read by the backend container from a host-side
# .secrets/database_url file (mounted via compose's `secrets:` block +
# DATABASE_URL_FILE), written by db/scripts/bootstrap_tencent.sh (called
# from ops/dev/setup.sh bootstrap with OPS_TIER=dev).

set -e

# PROJECT_DIR is needed by setup_dev_host_env. We use bash-trickery here:
# the caller sets $PROJECT_DIR by exporting the same value it uses for
# itself; if not exported, we fall back to a 2-level walk-up from
# ops/dev/.
: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Globals set by setup_dev_host_env ─────────────────────────────────────
SECRETS_DIR=".secrets"
DB_URL_FILE="${SECRETS_DIR}/database_url"
COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

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
    # Empty (after the chain) means "local-only mode" — auto-pull from
    # registry is disabled, but the dev compose still works (it pulls the
    # local image).
    resolve_docker_registry
    if [ -n "$DOCKER_REGISTRY" ]; then
        if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 仅 prod 用,dev 不 push)"
        else
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (setup 一次性 bootstrap 拉取用,start 不再 auto-pull)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (local-only mode — 仅本机使用)"
    fi
    # *_IMAGE_TAG resolve to per-segment VERSION files:
    #   BACKEND_IMAGE_TAG  ← backend/VERSION (gates both english_backend_dev + english_backend)
    #   FRONTEND_IMAGE_TAG ← frontend/VERSION (gates both frontend images)
    # No DB_IMAGE_TAG — the db is no longer a baked image, it's an external
    # TencentDB instance whose DSN lives in .secrets/database_url. The
    # schema version is the schema_migrations row count, not a tag.
    # Shell env still overrides. Exported for compose interpolation.
    resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
    resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
    warn_if_version_default "$BACKEND_IMAGE_TAG" backend/VERSION

    # Image full references (used in inspect / pull paths).
    # Prepend the registry prefix ONLY when DOCKER_REGISTRY was explicitly
    # configured (shell env or REGISTRY file). Auto-detected registries
    # (docker.io/$USER) are guesses — prepending them makes compose look
    # for "zhangyu528/english_backend_dev:v0.2.0" locally, which fails
    # because locally-built images are tagged "english_backend_dev:v0.2.0"
    # (no prefix). So when the source is "detect", force DOCKER_REGISTRY to
    # empty for the rest of the script — compose's
    #   image: ${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}
    # interpolates to the bare local name. Local-only mode effectively.
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
        BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    else
        BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
        # Force compose to use bare names too (its own image: line re-uses
        # $DOCKER_REGISTRY for the prefix).
        export DOCKER_REGISTRY=""
    fi
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE
}

# ─── write_secrets ──────────────────────────────────────────────────────────
# Ensures .secrets/database_url exists. The cloud-db DSN is written
# exclusively by db/scripts/bootstrap_tencent.sh (called from
# ops/dev/setup.sh bootstrap); this function is a *gate* that fails
# loudly if the file is missing — pointing the operator at the right
# subcommand. It does NOT generate or rewrite the DSN itself.
#
#   .secrets/database_url        (chmod 600) — cloud-db DSN, consumed
#                                              by compose's `secrets:`
#                                              block + backend's
#                                              DATABASE_URL_FILE.
#
# Idempotent: an existing .secrets/database_url is preserved (the cloud
# db's password + role are stable across restarts). To rotate, re-run
# ops/dev/setup.sh bootstrap.
write_secrets() {
    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    if [ ! -f "$DB_URL_FILE" ]; then
        err ".secrets/database_url 不存在 — 云 db 未配置"
        info "  → 运行 ops/dev/setup.sh bootstrap (一次性: 创建 ROLE/DB, 写 .secrets/database_url)"
        info "  → 或从已 bootstrap 过的同分支 dev 主机拷过来: scp other-dev:.secrets/database_url .secrets/"
        return 1
    fi
    chmod 600 "$DB_URL_FILE"
    info "复用现有 $(basename "$DB_URL_FILE")"
}

# ─── start_compose_watch / stop_compose_watch ──────────────────────────────
# Detach `docker compose watch` so it runs alongside the up -d containers.
# No-op if already running (PID file + kill -0 check).
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

# Kill the background compose watch (if running). SIGTERM first, escalate
# to SIGKILL after a short grace period.
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
    # Foreground — Ctrl+C to stop.
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch
}

# ─── gate_preflight ────────────────────────────────────────────────────────
# Verifies dev host readiness before starting the app stack:
#   1. Docker is installed and the daemon is up.
#   2. Backend + frontend images exist locally (built or pulled).
#   3. .secrets/database_url is present (cloud db bootstrap done).
#   4. Port 3000/8000 not bound on the host.
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
    if [ ! -f "$DB_URL_FILE" ]; then
        err ".secrets/database_url 不存在 — 云 db 未配置"
        info "  → 运行 ops/dev/setup.sh bootstrap"
        exit 1
    fi
    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
}

# ─── drift_check ──────────────────────────────────────────────────────────
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
