#!/usr/bin/env bash
#
# db/scripts/dev_db.sh — ensure the dev docker db is up.
#
# Sunk from dev/cli/run.js preflight (and from the deleted
# dev/cli/setup/preflight.sh before it). Owns:
#   1. docker stack check (docker install + daemon + compose available)
#   2. docker compose up -d db (if not running)
#   3. wait for healthy (up to 30s)
#
# Backend/scripts/dev.py calls this in its preflight step 1 to guarantee
# the database is reachable before migrations / imports / uvicorn start.
# Exit code 0 = db is healthy; non-zero with a clear message on failure.
#
# Standalone entry script — does NOT source dev/cli/_common.sh (that
# file is gone; everything db-related now lives here).

set -e

# Resolve project root (parent of db/scripts/) from this script's location
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE_UNIX="$PROJECT_DIR/dev-cli/docker-compose.dev.yml"

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Git Bash on Windows: docker compose doesn't grok Unix-style paths like
# /d/work/... — it interprets them as `d:\d\work\...` and fails to find
# the file. Convert to a native Windows path before invoking docker.
# On macOS / Linux, cygpath doesn't exist; the path is fine as-is.
to_native_path() {
    if command -v cygpath &> /dev/null; then
        cygpath -w "$1"
    else
        echo "$1"
    fi
}
COMPOSE_FILE="$(to_native_path "$COMPOSE_FILE_UNIX")"

cmd_dev_db_up() {
    # ─── 1. docker stack check ──────────────────────────────────────────
    if ! command -v docker &> /dev/null; then
        err "未找到 docker — 安装 Docker Desktop 后重试"
        return 1
    fi
    if ! timeout 5 docker info &> /dev/null; then
        err "docker daemon 未运行 — 启动 Docker Desktop 后重试"
        return 1
    fi
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        err "未找到 docker-compose / docker compose"
        return 1
    fi
    export DOCKER_COMPOSE_CMD

    # ─── 2. bring up db if not running ─────────────────────────────────
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -n "$cid" ]; then
        status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
        if [ "$status" = "healthy" ]; then
            ok "dev db 容器已 healthy"
            return 0
        fi
        err "dev db 容器状态: ${status:-unknown} (need healthy)"
        info "  → 等几秒再试,或: docker compose -f dev-cli/docker-compose.dev.yml restart db"
        return 1
    fi

    info "dev db 容器没起 — 自动起 db 服务..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=missing --no-deps db

    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "  db 服务没起来 — 看 docker compose logs db"
        return 1
    fi

    # ─── 3. wait for healthy (up to 30s) ────────────────────────────────
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 3
        status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
        if [ "$status" = "healthy" ]; then
            ok "  db 容器已 healthy"
            return 0
        fi
    done
    err "  db 容器 30s 内未 healthy (last status: ${status:-unknown})"
    info "  → 看日志: docker compose logs db"
    return 1
}

cmd_dev_db_up