#!/usr/bin/env bash
#
# ops/dev/migrate.sh — apply pending schema migrations to the live cloud db.
#
# The runtime database is now TencentDB — there is no longer a `db`
# service container to run the migration against on the dev host, so
# we drop the old sidecar-on-compose-network model and run the same
# migration runner on the host.
#
# Host prerequisites:
#   - python3 (with psycopg2-binary + sqlalchemy installed; the runner
#     imports these)
#   - DATABASE_URL in the process env, OR .secrets/database_url on
#     disk (typical after `ops/dev/setup.sh bootstrap`)
#
# The script sources db/scripts/lib.sh to resolve the cloud DSN, then
# delegates to db/scripts/migrate.sh (the same script the CMS host
# uses to migrate its source db). The Python implementation lives at
# backend/migrations/runner.py and is idempotent (IF NOT EXISTS
# guards + schema_migrations stamping).
#
# Usage:
#   eval "$(scripts/secrets/fetch_secrets.sh eval-db)"   # one-time
#   ./ops/dev/migrate.sh                                  # apply pending

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_migrate() {
    info "=== dev db migrate (host-side, target=cloud db) ==="
    echo ""

    if ! command -v python3 &> /dev/null; then
        err "python3 未安装 — migrations.runner 需要它"
        info "  → Ubuntu/Debian:  sudo apt install python3"
        info "  → macOS:          brew install python3"
        info "  → Windows:        winget install Python.Python.3.11"
        return 1
    fi

    # Resolve DATABASE_URL from .secrets/database_url if not already in
    # env. db/scripts/lib.sh uses the OPS_TIER=dev path (default), so
    # this picks up the dev role + per-user/per-branch db name.
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/db/scripts/lib.sh"
    if ! resolve_dev_db_url; then
        err "DATABASE_URL 解析失败 — 跑 ./ops/dev/setup.sh bootstrap 或 export DATABASE_URL"
        return 1
    fi

    # Delegate to db/scripts/migrate.sh — same script CMS host uses
    # for the source db. It re-resolves DATABASE_URL if needed but ours
    # is already in env, so db_assemble_url is a no-op.
    info "  target: $(awk -F/ '{print $3}' <<<"$DATABASE_URL")"
    echo ""
    if ! "$PROJECT_DIR/db/scripts/migrate.sh" "$@"; then
        err "migrate 失败 — 见上面错误"
        return 1
    fi

    echo ""
    ok "=== migrate 完成 ==="
    info "  backend hot reload 自动捡新 schema;要确认:"
    info "    ./ops/dev/lifecycle.sh restart"
}

cmd_migrate "$@"