#!/bin/bash
#
# ops/dev/import_content.sh — import cms/content/ into the dev db.
#
# Equivalent to ./db/scripts/import_staging.sh all, but routes through
# the dev docker-compose db (postgres:15-alpine running on the dev
# host via `docker compose up db`). Use this when you have new content
# files in cms/content/ and want them applied to your local dev db.
#
# The CMS host typically does this:
#   eval "$(./scripts/secrets/fetch_secrets.sh eval-cms)"   # AI/TENCENT/CLOUD
#   ./cms/run.sh                                          # produce content
#   ./db/scripts/import_staging.sh all                     # UPSERT to db
#
# A dev host that just wants the L step (import) can do:
#   ./ops/dev/import_content.sh          # or
#   make dev-import-content
#
# Equivalently, from inside the running container:
#   docker compose exec backend python -m importer all
#
# Prereqs (all standard on a bootstrapped dev host):
#   - python3 + psycopg2-binary + sqlalchemy on the host
#   - DATABASE_URL pointing at the docker postgres (compose exports
#     this for the backend service — for host-shell use, the
#     db/scripts/lib.sh::db_assemble_url helper assembles it from
#     POSTGRES_* env vars)
#
# Idempotent: UPSERTs content, then runs migrations. Normal migrations stay
# stamped; rerunnable backfills refresh derived lesson/link data.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_import() {
    info "=== dev db content import (target=dev docker postgres) ==="
    echo ""

    if ! command -v python3 &> /dev/null; then
        err "python3 未安装 — importer 需要它"
        return 1
    fi

    # Self-healing: bring up only the db service if it's not running.
    # This lets `./ops/dev/import_content.sh` work standalone (e.g. on
    # a fresh checkout right after setup, or after pulling new
    # cms/content/ from the CMS host) without forcing the operator to
    # also start backend/frontend.
    if ! ensure_dev_db_up; then
        return 1
    fi

    if ! require_staging_files; then
        return 1
    fi

    # Build DATABASE_URL for the dev docker postgres. Source of truth is
    # the compose file's `db` service environment (POSTGRES_USER /
    # POSTGRES_PASSWORD / POSTGRES_DB). Read them via `docker compose
    # config` so this script stays in sync if the operator edits
    # docker-compose.dev.yml — no hardcoded defaults to drift.
    #
    # The compose network's `db` hostname doesn't resolve from the host
    # shell, so we swap it for `localhost` (compose already bind-mounts
    # 5432:5432 to the host in dev mode).
    if [ -z "${DATABASE_URL:-}" ]; then
        local cfg pg_user pg_password pg_db pg_port="5432"
        cfg="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" config 2>/dev/null)" || {
            err "无法读 compose file: $COMPOSE_FILE"
            return 1
        }
        pg_user="$(printf '%s\n' "$cfg" | awk '/^  db:/{flag=1;next} flag && /^[a-z]/{flag=0} flag && /POSTGRES_USER:/{print $2; exit}')"
        pg_password="$(printf '%s\n' "$cfg" | awk '/^  db:/{flag=1;next} flag && /^[a-z]/{flag=0} flag && /POSTGRES_PASSWORD:/{print $2; exit}')"
        pg_db="$(printf '%s\n' "$cfg" | awk '/^  db:/{flag=1;next} flag && /^[a-z]/{flag=0} flag && /POSTGRES_DB:/{print $2; exit}')"
        if [ -z "$pg_user" ] || [ -z "$pg_password" ] || [ -z "$pg_db" ]; then
            err "compose file 里 db service 缺 POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB"
            info "  → 看 docker-compose.dev.yml services.db.environment"
            return 1
        fi
        # shellcheck disable=SC2155
        export DATABASE_URL="postgresql://${pg_user}:${pg_password}@localhost:${pg_port}/${pg_db}"
    fi

    info "  target: $(awk -F/ '{print $3}' <<<"$DATABASE_URL")"
    echo ""
    if ! bash "$PROJECT_DIR/db/scripts/import_staging.sh" all; then
        err "import 失败 — 见上面错误"
        return 1
    fi

    echo ""
    # Re-run schema migrations after import. This triggers the
    # rerunnable backfills (0007 lesson_index, 0008
    # sentence_word_links_backfill) so they populate any derived
    # columns/FK rows that the legacy importer skipped. Without this,
    # on a db that was bootstrapped while empty, lesson_index stays
    # NULL and sentence_word_links stays empty — the lesson router
    # would then return an empty words/sentences_by_word and the
    # frontend would show "该词库暂无可练习的句子".
    #
    # We use the host-side runner (db/scripts/migrate.sh → runner.py)
    # rather than waiting for the next backend container restart,
    # because in the common flow `./dev start` already brought up the
    # backend container — its entrypoint migrations ran on an empty
    # db, and won't re-run until the container recreates. Triggering
    # it here makes the data → migration ordering correct without
    # forcing an extra `./dev restart`.
    #
    # Idempotent: rerunnable migrations handle repeated runs, and
    # schema_migrations stamps the rest. Same DATABASE_URL as the
    # import above.
    info "  re-applying schema migrations (rerunnable backfills)..."
    if ! bash "$PROJECT_DIR/db/scripts/migrate.sh"; then
        err "migrate 失败 — 见上面错误"
        return 1
    fi

    echo ""
    ok "=== import 完成 ==="
    # import only writes Postgres rows (UPSERT in db/importer.py); the
    # backend Python code is unchanged, so no uvicorn reload / container
    # restart is needed. Rerunnable backfills (0007/0008) ran above so
    # lesson_index and sentence_word_links reflect the freshly-imported
    # data — the next API request returns the new content immediately.
}

cmd_import "$@"
