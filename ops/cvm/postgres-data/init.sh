#!/usr/bin/env bash
#
# ops/cvm/postgres-data/init.sh — initialize /var/lib/type-any-language/postgres.
#
# Bind-mount target for the postgres alpine container. Owned by UID 999
# (postgres alpine user) so the container can read/write it.
#
# Idempotent: existing dir is left alone (only its ownership is healed
# if it was somehow re-created with wrong perms).
#
# Run standalone:    ./ops/cvm/data-dir/install.sh
# Also called from:  bootstrap.sh::cmd_prepare

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_common.sh
source "$COMMON_DIR/../_common.sh"

DB_DATA_DIR="/var/lib/type-any-language/postgres"
# Postgres alpine image runs as UID 999 (postgres user). Bind-mount target
# must be owned by the same UID, otherwise container startup fails EACCES.
POSTGRES_UID=999

info "=== data-dir install ==="

if [ -d "$DB_DATA_DIR" ]; then
    ok "$DB_DATA_DIR 已存在"
    current_owner="$(stat -c '%u' "$DB_DATA_DIR" 2>/dev/null || echo "?")"
    if [ "$current_owner" = "$POSTGRES_UID" ]; then
        exit 0
    fi
    warn "  当前属主 UID=$current_owner,期望 UID=$POSTGRES_UID — 修正中"
    sudo_run_or_manual chown "$POSTGRES_UID:$POSTGRES_UID" "$DB_DATA_DIR" \
        || exit 1
    ok "  chown 修正完成"
    exit 0
fi

info "创建 $DB_DATA_DIR (UID=$POSTGRES_UID,postgres alpine 用户)..."
sudo_run_or_manual mkdir -p "$DB_DATA_DIR" || exit 1
sudo -n chmod 700 "$DB_DATA_DIR" 2>/dev/null || true
sudo_run_or_manual chown "$POSTGRES_UID:$POSTGRES_UID" "$DB_DATA_DIR" \
    || exit 1
ok "$DB_DATA_DIR 就绪"
