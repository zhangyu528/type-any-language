#!/bin/bash
#
# ops/dev/_common.sh — shared setup for the dev scripts.
#
# Sourced by every script in ops/dev/ — it does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single source
# of truth for: image tag resolution, db label inspection, secrets file
# writes, watch process lifecycle, port warnings.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_dev_host_env must be called before any other helper — it sets
#     all the *_IMAGE / *_FULL_IMAGE / *_IMAGE_TAG globals.

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
PG_PASSWORD_FILE="${SECRETS_DIR}/postgres_password"
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
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 仅 prod + db 用,dev 不 push)"
        else
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (setup 一次性 bootstrap 拉取用,start 不再 auto-pull)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (local-only mode — 仅本机使用)"
    fi
    DB_IMAGE="${DB_IMAGE:-english_db_content}"
    # *_IMAGE_TAG resolve to per-segment VERSION files:
    #   DB_IMAGE_TAG       ← db/VERSION (db is prod-bound content shared by both targets)
    #   BACKEND_IMAGE_TAG  ← backend/VERSION (gates both english_backend_dev + english_backend)
    #   FRONTEND_IMAGE_TAG ← frontend/VERSION (gates both frontend images)
    # Shell env still overrides. Exported for compose interpolation.
    resolve_image_tag DB_IMAGE_TAG       db/VERSION
    resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
    resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
    warn_if_version_default "$BACKEND_IMAGE_TAG" backend/VERSION

    # Image full references (used in inspect / pull paths).
    # Prepend the registry prefix ONLY when DOCKER_REGISTRY was explicitly
    # configured (shell env or REGISTRY file). Auto-detected registries
    # (docker.io/$USER) are guesses — prepending them makes compose look
    # for "zhangyu528/english_db_content:v0.2.0-rc.1" locally, which fails
    # because locally-built images are tagged "english_db_content:v0.2.0-rc.1"
    # (no prefix). So when the source is "detect", force DOCKER_REGISTRY to
    # empty for the rest of the script — compose's
    #   image: ${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG}
    # interpolates to the bare local name. Local-only mode effectively.
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
        DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
        BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    else
        DB_FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
        BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
        # Force compose to use bare names too (its own image: line re-uses
        # $DOCKER_REGISTRY for the prefix).
        export DOCKER_REGISTRY=""
    fi
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE
}

# ─── inspect_db_image_labels ────────────────────────────────────────────────
# Reads DB_USER, DB_NAME, DB_VERSION, DB_BAKED_AT from the db image's OCI
# labels and exports them. Returns 0 if both required labels are present.
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

# ─── export_db_identity_for_compose ────────────────────────────────────────
# Make sure DB_USER / DB_NAME are set so compose interpolation
# (${DB_USER:?...} / ${DB_NAME:?...} in docker-compose.dev.yml) doesn't
# fail. Used by read-only subcommands (`status` / `stop` / `logs`) where
# the *actual* values don't matter for the operation — we just need
# *some* non-empty value to satisfy compose's strict interpolation.
#
# Falls back to the same defaults bake uses (english_user /
# english_learning) when the content-baked db image isn't around locally.
export_db_identity_for_compose() {
    if inspect_db_image_labels; then
        return 0
    fi
    DB_USER="${DB_USER:-english_user}"
    DB_NAME="${DB_NAME:-english_learning}"
    export DB_USER DB_NAME
}

# ─── write_secrets ──────────────────────────────────────────────────────────
# Materialises host-side secrets on disk so compose can mount them as
# files into the db and backend containers (via POSTGRES_PASSWORD_FILE
# and DATABASE_URL_FILE).
#
#   .secrets/postgres_password   (chmod 600) — generated on first start,
#                                              reused across restarts
#   .secrets/database_url        (chmod 600) — assembled from above +
#                                              DB_USER / DB_NAME from image
#
# Idempotent: existing .secrets/postgres_password is preserved across
# restarts so the db volume's password stays stable. To reset the dev
# db, delete the file (and the db-data volume).
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

    # database_url: postgresql://<user>:<password>@db:5432/<name>
    if command -v python3 &> /dev/null; then
        encoded_pw="$(DB_USER="$DB_USER" DB_NAME="$DB_NAME" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            python3 -c 'import os, urllib.parse; print("postgresql://%s:%s@db:5432/%s" % (urllib.parse.quote(os.environ["DB_USER"]), urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""), os.environ["DB_NAME"]))')"
    else
        encoded_pw="postgresql://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"
    fi
    printf '%s' "$encoded_pw" > "$DB_URL_FILE"
    chmod 600 "$DB_URL_FILE"
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
    if ! image_exists "$DB_FULL_IMAGE"; then
        err "content-baked db image $DB_FULL_IMAGE 未构建或未拉取"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  → 设置 DB_IMAGE_TAG 后由脚本拉取,或: docker pull $DB_FULL_IMAGE"
        else
            info "  → 运行 db/scripts/build.sh(可用 --tag dev 标记)"
            info "  → 之后再次运行 ops/dev/start.sh"
        fi
        exit 1
    fi
    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"
}

# ─── drift_check ──────────────────────────────────────────────────────────
# Compare running containers' type-any-language.app.version LABEL against
# the locally-resolved *_IMAGE_TAG. Warns on mismatch. Skipped silently
# if no containers are running.
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
