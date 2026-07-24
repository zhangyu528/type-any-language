#!/bin/bash
#
# ops/dev/migrate.sh — apply pending schema migrations to the dev db.
#
# The dev db is a `postgres:15-alpine` container in the same compose
# file as backend. Two equivalent ways to run this:
#
#   1. From the host shell:
#      DATABASE_URL=postgresql://english_dev:devpw@localhost:5432/english_dev \
#          ./ops/dev/migrate.sh
#      (or `./ops/dev/migrate.sh` after `docker compose up db`)
#
#   2. From inside the backend container (entrypoint.sh does this
#      automatically on every start):
#      docker compose exec backend ./db/scripts/migrate.sh
#
# We delegate to db/scripts/migrate.sh which calls
# backend/migrations/runner.py. Idempotent (IF NOT EXISTS guards +
# schema_migrations stamping).
#
# Host prerequisites:
#   - python3 (with psycopg2-binary + sqlalchemy installed)
#   - DATABASE_URL pointing at the local docker postgres (either in
#     env or assembled by db_assemble_url from POSTGRES_*)

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_migrate() {
    info "=== dev db migrate (host-side) ==="
    echo ""

    if ! command -v python3 &> /dev/null; then
        err "python3 未安装 — migrations.runner 需要它"
        info "  → Ubuntu/Debian:  sudo apt install python3"
        info "  → macOS:          brew install python3"
        info "  → Windows:        winget install Python.Python.3.11"
        return 1
    fi

    if ! require_dev_db_up; then
        return 1
    fi

    # Try to assemble DATABASE_URL. Order of preference:
    #   1. already in env
    #   2. POSTGRES_HOST=localhost + assemble (suitable if you have
    #      postgres:15-alpine running on the host via compose)
    if [ -z "${DATABASE_URL:-}" ]; then
        # shellcheck disable=SC1091
        source "$PROJECT_DIR/db/scripts/lib.sh"
        if ! db_assemble_url; then
            return 1
        fi
    fi

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
    info "  或直接由 backend entrypoint 自动跑:"
    info "    docker compose restart backend"
}

cmd_migrate "$@"
