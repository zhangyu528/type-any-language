#!/bin/bash
#
# ops/dev/db_list.sh — list all dev dbs in the shared TencentDB instance
# that belong to the current $USER. Read-only, no writes.
#
# Naming convention: english_dev_<user>[__<branch_or_sha>]
#   - master/main branch → just english_dev_<user>
#   - any other branch   → english_dev_<user>__<branch>
#   - detached HEAD      → english_dev_<user>__<sha>
#
# Usage:
#   ./ops/dev/db_list.sh           # list this user's dbs
#   ./ops/dev/db_list.sh --all    # list every dev db in the instance (admin only)
#
# Requires:
#   - .secrets/tencent_db_admin_url (created by setup.sh bootstrap)
#   - psql on PATH
#
# Exit codes:
#   0  ok (including no rows; some users may not yet have bootstrapped)
#   1  psql missing or admin url missing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../lib.sh"

if ! command -v psql &>/dev/null; then
    err "psql 未安装 — install postgresql-client"
    exit 1
fi

ADMIN_URL_FILE="$PROJECT_DIR/.secrets/tencent_db_admin_url"
if [ ! -f "$ADMIN_URL_FILE" ]; then
    err "找不到 $ADMIN_URL_FILE"
    err "  → 跑 ./ops/dev/setup.sh bootstrap 一次获取 admin DSN"
    exit 1
fi
ADMIN_URL="$(cat "$ADMIN_URL_FILE")"

USER_NAME="${USER:-}"
if [ -z "$USER_NAME" ] && command -v whoami &>/dev/null; then
    USER_NAME="$(whoami 2>/dev/null || echo "")"
fi

echo ""
info "=== dev dbs on the shared TencentDB instance ==="
echo ""

if [ "${1:-}" = "--all" ]; then
    # Show every dev_* db (admin-style view)
    PATTERN="english_dev_%"
    HEADER="all users (english_dev_*)"
else
    # Show this user's dbs only
    if [ -z "$USER_NAME" ]; then
        err "USER not set — pass --all to list everyone's dbs"
        exit 1
    fi
    PATTERN="english_dev_${USER_NAME}%"
    HEADER="user=$USER_NAME (english_dev_${USER_NAME}*)"
fi

info "scope: $HEADER"
echo ""

ROWS="$(psql "$ADMIN_URL" -tA -F'|' -c "
    SELECT datname,
           pg_database_size(oid) AS size_bytes,
           pg_stat_get_db_create_time(oid) AS created_at
    FROM pg_database
    WHERE datname LIKE '$PATTERN'
    ORDER BY datname;
")"

if [ -z "$ROWS" ]; then
    info "  (no dbs found — run ./ops/dev/setup.sh bootstrap to create the first one)"
    exit 0
fi

# Pretty-print the result. Format sizes as KiB/MiB/GiB.
printf '%-45s %10s %s\n' "db name" "size" "created"
printf '%-45s %10s %s\n' "-------" "----" "-------"

while IFS='|' read -r name size_bytes created_at; do
    [ -z "$name" ] && continue
    size_human="$(numfmt --to=iec --suffix=B "$size_bytes" 2>/dev/null \
                  || echo "${size_bytes} bytes")"
    created_iso="$(date -u -d "@$created_at" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
                   || echo "$created_at")"
    printf '%-45s %10s %s\n' "$name" "$size_human" "$created_iso"
done <<< "$ROWS"

echo ""
info "tip:"
info "  ./ops/dev/db_drop.sh <name>   # delete a dev db to free storage"
info "  ./ops/dev/db_drop.sh --all-untouched  # delete dbs whose branch was deleted (planned)"