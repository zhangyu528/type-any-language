#!/usr/bin/env bash
#
# dev-tools/doctor.sh — pre-flight env check (read-only).
#
# Validates that everything the host-native dev loop needs is in
# place — docker (for the postgres container), compose, the host
# python + node, the backend venv + frontend node_modules, and the
# db bind-mount target. Does NOT modify anything on disk or call
# docker compose.
#
# The runtime db is a `postgres:15-alpine` container in
# docker-compose.dev.yml. doctor doesn't probe the db directly — if
# compose is up, the db is up; if compose is down, `native.sh start`
# will create it on next start. The only db-state check is whether
# the bind-mount target is writable (so the first start can create
# the data dir).
#
# Host-native dev path (`make dev-start`): requires python3 ≥ 3.11,
# node ≥ 20, npm, `backend/.venv/bin/uvicorn`, `frontend/node_modules`.
# Their absence is a WARN (not a hard fail) — the operator may be
# running only a subset (e.g. just import content without coding).
#
# Exit: 0 if all required checks pass; 1 if any required check fails.
#
# Counterpart to dev/{native,setup,logs,migrate,import_content}.sh.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"

cmd_doctor() {
    local failed=0
    echo "=== Development environment check ==="
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

    # db-bind-mount target writability. compose creates the dir on first
    # up if it doesn't exist, but the parent (./.dev) needs to be writable
    # by the docker daemon user.
    local pg_data_dir="./.docker-postgres-data"
    if [ ! -d "$pg_data_dir" ]; then
        # Not existing yet is fine (compose will mkdir it).
        info "  $pg_data_dir 还不存在 — 首次 start 时 compose 会创建空 db"
    elif [ -w "$pg_data_dir" ]; then
        ok "  $pg_data_dir 可写"
    else
        err "  $pg_data_dir 存在但不可写 — sudo chown $USER:$USER $pg_data_dir"
        failed=1
    fi

    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"

    # Optional: live db health probe if compose is up.
    if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db &>/dev/null 2>&1; then
        local cid
        cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1)"
        if [ -n "$cid" ] && docker inspect "$cid" \
            --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
            ok "db 容器 healthcheck: healthy"
        fi
    fi

    # ─── Host-native dev deps (make dev-start needs these) ─────────────────
    # Backend deps: delegated to backend's own preflight
    # (backend/scripts/preflight.py). Mirrors the frontend pattern: each
    # segment owns its self-check.
    echo "--- backend preflight (python3 scripts/preflight.py) ---"
    if command -v python3 >/dev/null 2>&1 && [ -f "./backend/scripts/preflight.py" ]; then
        if (cd backend && python3 scripts/preflight.py 2>&1); then
            : # preflight already prints ok/warn/err itself
        else
            warn "  backend preflight 返回非零 — 看上面"
            failed=1
        fi
    else
        warn "  跳过 — python3 或 backend/scripts/preflight.py 缺失"
    fi

    # Frontend deps: delegated to frontend's own preflight.
    # The script exits non-zero on hard failures; we record but don't
    # fail doctor — frontend may not be the operator's focus (e.g.
    # they're only running the CMS importer or prod-only work).
    echo "--- frontend preflight (npm run preflight) ---"
    if command -v npm >/dev/null 2>&1 && [ -f "./frontend/package.json" ]; then
        if (cd frontend && npm run preflight 2>&1); then
            : # preflight already prints ok/warn/err itself
        else
            warn "  frontend preflight 返回非零 — 看上面"
            failed=1
        fi
    else
        warn "  跳过 — npm 或 frontend/package.json 缺失"
    fi

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
