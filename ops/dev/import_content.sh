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
# Idempotent: re-runs are no-ops (UPSERT on natural keys).

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

    if [ -z "${DATABASE_URL:-}" ]; then
        # shellcheck disable=SC1091
        source "$PROJECT_DIR/db/scripts/lib.sh"
        if ! db_assemble_url; then
            return 1
        fi
    fi

    info "  target: $(awk -F/ '{print $3}' <<<"$DATABASE_URL")"
    echo ""
    if ! "$PROJECT_DIR/db/scripts/import_staging.sh" all; then
        err "import 失败 — 见上面错误"
        return 1
    fi

    echo ""
    ok "=== import 完成 ==="
    info "  backend hot reload 自动捡新 content;要确认:"
    info "    ./ops/dev/lifecycle.sh restart"
    info "  或直接到 backend 容器跑:"
    info "    docker compose exec backend python -m importer all"
}

cmd_import "$@"
