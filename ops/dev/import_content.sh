#!/bin/bash
#
# ops/dev/import_content.sh — import cms/content/ into the dev cloud db.
#
# Equivalent to ./db/scripts/import_staging.sh all, but routes through
# db/scripts/lib.sh::resolve_dev_db_url so the dev's per-user / per-branch
# cloud db (english_dev_<user>__<branch>) is the target. Use this when
# you have new content files in cms/content/ and want them applied to
# your own dev db without ssh'ing to the CMS host.
#
# The CMS host typically does this:
#   eval "$(./scripts/secrets/fetch_secrets.sh eval-cms)"   # AI/TENCENT/CLOUD
#   ./cms/run.sh                                          # produce content
#   ./db/scripts/import_staging.sh all                     # UPSERT to cloud db
#
# A dev host that just wants the L step (import) can do:
#   ./ops/dev/import_content.sh          # or
#   make db-import-dev
#
# Prereqs (all standard on a bootstrapped dev host):
#   - python3 + psycopg2-binary + sqlalchemy on the host
#   - .secrets/database_url present (or DATABASE_URL in env)
#
# Idempotent: re-runs are no-ops (UPSERT on natural keys).

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_import() {
    info "=== dev db content import (target=dev cloud db) ==="
    echo ""

    if ! command -v python3 &> /dev/null; then
        err "python3 未安装 — importer 需要它"
        return 1
    fi

    # shellcheck disable=SC1091
    source "$PROJECT_DIR/db/scripts/lib.sh"
    if ! resolve_dev_db_url; then
        err "DATABASE_URL 解析失败 — 跑 ./ops/dev/setup.sh bootstrap 或 export DATABASE_URL"
        return 1
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
}

cmd_import "$@"