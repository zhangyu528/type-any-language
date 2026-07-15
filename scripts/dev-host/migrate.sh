#!/usr/bin/env bash
#
# scripts/dev-host/migrate.sh — apply pending schema migrations to running db.
#
# Lightweight dev iteration path. Equivalent to running
# `cms/scripts/env.sh` then running the migration runner, but targets the
# runtime db directly via a one-shot sidecar container on the compose
# network — so no image bake, no registry, no volume drop.
#
# Why a sidecar: the runtime db container is postgres:15-alpine, which
# has psql but no python. The migration runner is Python. We use the
# already-cached backend image as the sidecar — it's FROM python:3.11-slim
# with psycopg2-binary + sqlalchemy already pip-installed.
#
# We mount cms/ and backend/ read-only into the sidecar and run
# `cms.migrations.runner` against `db:5432`. cms/.env lives under the
# existing `-v cms:/cms:ro` mount (no separate env-file bind needed).
#
# Idempotent: runner.py uses IF NOT EXISTS / IF EXISTS and stamps
# applied versions in schema_migrations. Re-runs are no-ops.
#
# Backend picks up the new schema on the next request (no restart needed).
# But ./scripts/dev-host/lifecycle.sh restart works fine too.
#
# Offline fallback: cms/cms_pipeline/migrations/apply_to_runtime.sql brings
# a stale db up to head. Use when no backend image is cached and
# python:3.11-slim can't be pulled either.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_migrate() {
    info "=== dev db migrate ==="
    echo ""
    require_docker

    export_db_identity_for_compose

    local db_cid
    db_cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1)"
    if [ -z "$db_cid" ]; then
        err "db 容器没在跑 — 先 ./scripts/dev-host/lifecycle.sh start"
        return 1
    fi

    local network
    network="$(docker inspect "$db_cid" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -1)"
    if [ -z "$network" ]; then
        err "找不到 db 容器的 compose network"
        return 1
    fi

    local pg_user="${POSTGRES_USER:-english_user}"
    local pg_db="${POSTGRES_DB:-english_learning}"
    if [ ! -f "$PG_PASSWORD_FILE" ]; then
        err "$PG_PASSWORD_FILE 不存在 — 先跑 start (它会现场生成)"
        return 1
    fi
    local pg_pass
    pg_pass="$(cat "$PG_PASSWORD_FILE")"

    local sidecar_image
    local backend_cid
    backend_cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q backend 2>/dev/null | head -1)"
    if [ -n "$backend_cid" ]; then
        sidecar_image="$(docker inspect "$backend_cid" --format '{{.Config.Image}}' 2>/dev/null)"
        info "用 backend 镜像做 sidecar (无 pull 开销): $sidecar_image"
    elif image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        sidecar_image="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        info "用本地 backend 镜像做 sidecar (无 pull 开销): $sidecar_image"
    else
        info "backend 没在跑也没本地镜像 — 尝试拉 python:3.11-slim ..."
        if ! docker pull -q python:3.11-slim >/dev/null 2>&1; then
            warn "pull python:3.11-slim 失败 (offline?)"
            info "  离线 fallback: docker exec -i -e PGPASSWORD=\$(cat $PG_PASSWORD_FILE) \\"
            info "    $db_cid psql -U $pg_user -d $pg_db \\"
            info "    < cms/cms_pipeline/migrations/apply_to_runtime.sql"
            return 1
        fi
        sidecar_image="python:3.11-slim"
    fi

    echo ""
    info "在 sidecar 里跑 cms.migrations.runner (target=db:5432)..."
    # On Windows (Git Bash + Docker Desktop), MSYS path translation turns
    # MSYS-style paths like /d/work/... into Windows paths when bash
    # interpolates them into `docker -v`. cygpath -w feeds Windows-style
    # absolute paths that Docker Desktop accepts verbatim.
    local content_mount backend_mount secrets_mount
    if command -v cygpath >/dev/null 2>&1; then
        content_mount="$(cygpath -w "$PROJECT_DIR/cms")"
        backend_mount="$(cygpath -w "$PROJECT_DIR/backend")"
        secrets_mount="$(cygpath -w "$PROJECT_DIR/.secrets")"
    else
        content_mount="$PROJECT_DIR/cms"
        backend_mount="$PROJECT_DIR/backend"
        secrets_mount="$PROJECT_DIR/.secrets"
    fi
    if ! MSYS_NO_PATHCONV=1 docker run --rm \
            --network "$network" \
            -v "$content_mount:/cms:ro" \
            -v "$backend_mount:/backend:ro" \
            -v "$secrets_mount:/.secrets:ro" \
            -e POSTGRES_HOST="db" \
            -e POSTGRES_PORT="5432" \
            -e POSTGRES_USER="$pg_user" \
            -e POSTGRES_DB="$pg_db" \
            -e POSTGRES_PASSWORD="$pg_pass" \
            --entrypoint bash \
            "$sidecar_image" \
            -c "PYTHONPATH=/cms/tools:/backend exec python -m cms.migrations.runner"
    then
        err "migrate 失败 — 见上面错误"
        return 1
    fi

    echo ""
    ok "=== migrate 完成 ==="
    info "  backend hot reload 自动捡新 schema;要确认:"
    info "    ./scripts/dev-host/lifecycle.sh restart"
}

cmd_migrate
