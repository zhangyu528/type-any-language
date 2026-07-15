#!/bin/bash
#
# db/scripts/source_db.sh — manage the cms-source-db container (the
# staging db the CMS pipeline writes content into, and the db image
# bake reads from).
#
# Lives in db/scripts/ because container lifecycle is a db concern —
# db is the consumer of this staging data, and the db's build flow
# (db/scripts/build.sh) needs a populated db to read. CMS run.sh
# also calls this (via `ensure` subcommand) for its own write needs.
#
# Subcommands:
#   ensure   Idempotent. Start a populated cms-source-db if not
#            already running. Returns 0 if a db is reachable after
#            the call, 1 otherwise. Used by both db-side build flows
#            and CMS-side run.sh.
#   start    Force-start a cms-source-db (creates one if absent).
#   stop     Stop a running cms-source-db (no-op if not running).
#   status   Print whether cms-source-db is up + which container
#            holds it (resolves legacy english_db / english_db_dev
#            too).
#
# Why "cms-source-db" and not "db":
#   The application dev/prod stack also creates containers called
#   english_db / english_db_dev (the runtime db for the dev/prod app).
#   A separate name for the *staging* db avoids confusion: cms-source-db
#   is the CMS pipeline's data target, not the app's runtime db. The
#   data lives in a docker volume `cms-source-data` that persists
#   across container recreates (typical after `docker stop` between
#   sessions).
#
# Why this lives in db/scripts/ and not cms/scripts/:
#   Container lifecycle is a host-provisioning concern that both
#   db/scripts/build.sh (read side) and cms/run.sh
#   (write side) need. Putting it in either would mean the other
#   side calls across the boundary. db/scripts/source_db.sh is the
#   neutral host for it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck disable=SC1091
source "$PROJECT_DIR/scripts/lib.sh"

# Conventions.
SOURCE_CONTAINER="cms-source-db"
SOURCE_VOLUME="cms-source-data"
# Legacy names that this script still detects and adopts (so an
# existing operator with a previously-named container doesn't have to
# re-create it). When the script finds one of these stopped, it
# renames it to cms-source-db in-place (preserves the data volume).
LEGACY_CONTAINER_NAMES=("english_db" "english_db_dev")

# Resolve user / db / password from env (cms/.env) or shell.
# Falls back to code defaults (same as db/scripts/build.sh) so the
# script works in CI too.
load_source_db_env() {
    : "${POSTGRES_USER:=english_user}"
    : "${POSTGRES_DB:=english_learning}"
    # POSTGRES_PASSWORD comes from shell env first, then .secrets/, then
    # cms/.env (whichever loaded first).
    if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -f "$PROJECT_DIR/.secrets/postgres_password" ]; then
        POSTGRES_PASSWORD="$(cat "$PROJECT_DIR/.secrets/postgres_password")"
    fi
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        err "POSTGRES_PASSWORD unset — export it, or copy .secrets/postgres_password from a dev/prod host"
        return 1
    fi
    : "${POSTGRES_HOST:=localhost}"
    : "${POSTGRES_PORT:=5432}"
    export POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD POSTGRES_HOST POSTGRES_PORT
}

# detect_running_source_db — return the running container name (any of
# cms-source-db, english_db, english_db_dev) or empty.
detect_running_source_db() {
    docker ps --format '{{.Names}}' 2>/dev/null \
        | grep -E "^(${SOURCE_CONTAINER}|$(IFS='|'; echo "${LEGACY_CONTAINER_NAMES[*]}"))$" \
        | head -1
}

# start_source_db — create + start a cms-source-db container. Re-uses
# a stopped one if present (preserves the data volume).
start_source_db() {
    if ! command -v docker >/dev/null 2>&1; then
        err "docker not installed — start one with `apt install docker.io` / Docker Desktop"
        return 1
    fi
    if ! docker info >/dev/null 2>&1; then
        err "docker daemon not running (start Docker Desktop / dockerd)"
        return 1
    fi

    # Already running? Nothing to do.
    local running
    running="$(detect_running_source_db)"
    if [ -n "$running" ]; then
        ok "  source db: container '$running' 已在跑"
        # Ensure it's named cms-source-db for downstream callers. If it's
        # still on a legacy name, rename (data volume is preserved).
        if [ "$running" != "$SOURCE_CONTAINER" ]; then
            info "  重命名 '$running' → '$SOURCE_CONTAINER' (保留数据卷)"
            if docker rename "$running" "$SOURCE_CONTAINER" >/dev/null; then
                return 0
            else
                warn "  docker rename 失败 (跨 host 迁移或挂载冲突?) — 继续使用 '$running'"
                return 0
            fi
        fi
        return 0
    fi

    # Stopped legacy container? Adopt it (rename) instead of creating
    # a fresh one — preserves the volume.
    for legacy in "${LEGACY_CONTAINER_NAMES[@]}"; do
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qE "^${legacy}$"; then
            info "  发现 legacy 容器 '$legacy' — 重命名为 '$SOURCE_CONTAINER' (保留数据卷)"
            if docker rename "$legacy" "$SOURCE_CONTAINER" >/dev/null 2>&1; then
                info "  docker start $SOURCE_CONTAINER"
                docker start "$SOURCE_CONTAINER" >/dev/null
                return 0
            else
                warn "  重命名失败 — 继续,创建新容器"
                break
            fi
        fi
    done

    info "  创建 $SOURCE_CONTAINER (postgres:15-alpine)..."
    if ! docker run -d \
            --name "$SOURCE_CONTAINER" \
            -e "POSTGRES_USER=$POSTGRES_USER" \
            -e "POSTGRES_DB=$POSTGRES_DB" \
            -e "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
            -p "${POSTGRES_PORT}:5432" \
            -v "$SOURCE_VOLUME:/var/lib/postgresql/data" \
            postgres:15-alpine >/dev/null; then
        err "  docker run $SOURCE_CONTAINER 失败 — 检查 docker / 端口冲突 (${POSTGRES_HOST}:${POSTGRES_PORT})"
        return 1
    fi
    return 0
}

# wait_source_db_ready — block (max 30s) for the source db to accept
# connections. Uses docker exec + pg_isready so this works on hosts
# without postgresql-client installed (Windows / macOS).
wait_source_db_ready() {
    info "  等 $SOURCE_CONTAINER 就绪 (最多 30s)..."
    local i
    for i in $(seq 1 30); do
        if docker exec "$SOURCE_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; then
            ok "  source db: $SOURCE_CONTAINER 就绪"
            return 0
        fi
        sleep 1
    done
    err "  $SOURCE_CONTAINER 30s 内未就绪 — 看 docker logs $SOURCE_CONTAINER 找原因"
    return 1
}

cmd_ensure() {
    load_source_db_env || return 1

    # 1. running container?
    local running
    running="$(detect_running_source_db)"
    if [ -n "$running" ]; then
        ok "  source db: container '$running' 已在跑"
        # Re-adopt the legacy name to cms-source-db if needed.
        if [ "$running" != "$SOURCE_CONTAINER" ]; then
            docker rename "$running" "$SOURCE_CONTAINER" 2>/dev/null || true
        fi
        return 0
    fi

    # 2. local postgres reachable at POSTGRES_HOST:POSTGRES_PORT?
    #    Skip silently if host has no psql — fall through to docker run.
    if command -v psql >/dev/null 2>&1 && \
       PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
            -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1" &>/dev/null; then
        ok "  source db: 本地 postgres ($POSTGRES_HOST:$POSTGRES_PORT) 可达"
        return 0
    fi

    # 3. start a fresh container.
    start_source_db || return 1
    wait_source_db_ready || return 1
    return 0
}

cmd_start() {
    load_source_db_env || return 1
    start_source_db || return 1
    wait_source_db_ready || return 1
    ok "  source db: $SOURCE_CONTAINER started"
}

cmd_stop() {
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qE "^${SOURCE_CONTAINER}$"; then
        info "  $SOURCE_CONTAINER 没在跑 (no-op)"
        return 0
    fi
    info "  停 $SOURCE_CONTAINER..."
    docker stop "$SOURCE_CONTAINER" >/dev/null
    ok "  source db: $SOURCE_CONTAINER stopped"
}

cmd_status() {
    local running
    running="$(detect_running_source_db)"
    if [ -n "$running" ]; then
        echo "  source db: RUNNING (container=$running)"
    else
        echo "  source db: NOT RUNNING"
        echo "  (start with: db/scripts/source_db.sh start, or"
        echo "   prepare a local postgres with POSTGRES_HOST/PORT)"
    fi
    # Show the volume too.
    if docker volume inspect "$SOURCE_VOLUME" >/dev/null 2>&1; then
        echo "  source data: volume '$SOURCE_VOLUME' exists"
    else
        echo "  source data: no '$SOURCE_VOLUME' volume yet (first start creates it)"
    fi
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  ensure   Idempotent start. Returns 0 if a source db is reachable
           after the call (running container, local postgres, or fresh
           docker run). Used by cms/run.sh and
           db/scripts/build.sh.
  start    Force-start a cms-source-db container. Creates one if absent.
  stop     Stop a running cms-source-db (no-op if not running).
  status   Print current state.

环境(shell env 或 cms/.env):
  POSTGRES_USER     db user (default: english_user)
  POSTGRES_DB       db name (default: english_learning)
  POSTGRES_PASSWORD db password (REQUIRED — env or .secrets/postgres_password)
  POSTGRES_HOST     host for local-postgres fallback (default: localhost)
  POSTGRES_PORT     port (default: 5432)
EOF
}

case "${1:-}" in
    ensure) cmd_ensure ;;
    start)  cmd_start ;;
    stop)   cmd_stop ;;
    status) cmd_status ;;
    ""|-h|--help|help) usage ;;
    *)      err "未知命令: $1"; usage; exit 1 ;;
esac