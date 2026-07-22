#!/usr/bin/env bash
#
# ops/dev/migrate.sh — apply pending schema migrations to running db.
#
# Lightweight dev iteration path. Equivalent to running
# `cms/scripts/bootstrap.sh` (the GH-Secrets eval-cms + pip install
# flow) then running the migration runner, but targets the runtime
# db directly via a one-shot sidecar container on the compose network
# — so no image bake, no registry, no volume drop.
#
# Why a sidecar: the runtime db container is postgres:15-alpine, which
# has psql but no python. The migration runner is Python. We use the
# already-cached backend image as the sidecar — it's FROM python:3.11-slim
# with psycopg2-binary + sqlalchemy already pip-installed.
#
# We mount db read-only into the sidecar and run
# `dbtools.migrations.runner` against `db:5432`. Migrations live at
# `db/dbtools/migrations/` — same script as `db/scripts/migrate.sh`
# uses on the CMS host for the source db.
#
# Idempotent: runner.py uses IF NOT EXISTS / IF EXISTS and stamps
# applied versions in schema_migrations. Re-runs are no-ops.
#
# Backend picks up the new schema on the next request (no restart needed).
# But ./ops/dev/lifecycle.sh restart works fine too.
#
# Offline fallback: db/dbtools/migrations/apply_to_runtime.sql brings
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
        err "db 容器没在跑 — 先 ./ops/dev/lifecycle.sh start"
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
            info "    < db/dbtools/migrations/apply_to_runtime.sql"
            return 1
        fi
        sidecar_image="python:3.11-slim"
    fi

    echo ""
    info "在 sidecar 里跑 dbtools.migrations.runner (target=db:5432)..."
    # On Windows (Git Bash + Docker Desktop), MSYS path translation turns
    # MSYS-style paths like /d/work/... into Windows paths when bash
    # interpolates them into `docker -v`. cygpath -w feeds Windows-style
    # absolute paths that Docker Desktop accepts verbatim.
    local db_tools_mount secrets_mount
    if command -v cygpath >/dev/null 2>&1; then
        db_tools_mount="$(cygpath -w "$PROJECT_DIR/db")"
        secrets_mount="$(cygpath -w "$PROJECT_DIR/.secrets")"
    else
        db_tools_mount="$PROJECT_DIR/db"
        secrets_mount="$PROJECT_DIR/.secrets"
    fi
    # Assemble DATABASE_URL inside the sidecar the same way db/scripts/migrate.sh
    # does (url-encoded). The runner reads DATABASE_URL, not the discrete
    # POSTGRES_* env vars.
    local db_url
    if command -v python3 >/dev/null 2>&1; then
        db_url="$(
            POSTGRES_USER="$pg_user" POSTGRES_DB="$pg_db" \
            POSTGRES_HOST="db" POSTGRES_PORT="5432" \
            POSTGRES_PASSWORD="$pg_pass" \
            python3 -c '
import os, urllib.parse
print("postgresql://%s:%s@%s:%s/%s" % (
    urllib.parse.quote(os.environ["POSTGRES_USER"], safe=""),
    urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""),
    os.environ["POSTGRES_HOST"], os.environ["POSTGRES_PORT"],
    os.environ["POSTGRES_DB"]
))'
        )"
    else
        db_url="postgresql://${pg_user}:${pg_pass}@db:5432/${pg_db}"
    fi
    # Mount db (not cms/) read-only so the sidecar's
    # `python -m dbtools.migrations.runner` can resolve
    # `dbtools.migrations.versions` (the migrations package lives at
    # db/dbtools/migrations/, owned by the db side after the
    # 5d16afe cms/db split). This mirrors db/scripts/migrate.sh's
    # PYTHONPATH=db + python -m dbtools.migrations.runner.
    #
    # Do NOT override --entrypoint: keep the image's default
    # `sh ./entrypoint.sh` so the sidecar runs hash-aware pip install
    # first (dev image has no baked site-packages — see
    # backend/Dockerfile.dev "No `RUN pip install`"). entrypoint.sh
    # ends with `exec "$@"`, which runs the CMD we pass below.
    if ! MSYS_NO_PATHCONV=1 docker run --rm \
            --network "$network" \
            -v "$db_tools_mount:/db:ro" \
            -v "$secrets_mount:/.secrets:ro" \
            -e DATABASE_URL="$db_url" \
            -e PYTHONPATH="/db" \
            "$sidecar_image" \
            python -m dbtools.migrations.runner
    then
        err "migrate 失败 — 见上面错误"
        return 1
    fi

    echo ""
    ok "=== migrate 完成 ==="
    info "  backend hot reload 自动捡新 schema;要确认:"
    info "    ./ops/dev/lifecycle.sh restart"
}

cmd_migrate
