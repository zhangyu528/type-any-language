#!/usr/bin/env bash
#
# ops/cvm/secrets/install.sh — generate .secrets/db_password.
#
# Idempotent: if the file already exists, we don't touch it (preserves
# the running prod db's credentials on a re-run — changing this would
# brick the running db).
#
# Run standalone:    ./ops/cvm/secrets/install.sh
# Also called from:  bootstrap.sh::cmd_prepare

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=../_common.sh
source "$COMMON_DIR/../_common.sh"

SECRETS_DIR_NAME=".secrets"
DB_PASSWORD_FILE="${SECRETS_DIR_NAME}/db_password"

info "=== secrets install ==="
mkdir -p "$PROJECT_DIR/.secrets"
chmod 700 "$PROJECT_DIR/.secrets"

if [ -f "$PROJECT_DIR/$DB_PASSWORD_FILE" ]; then
    ok ".secrets/db_password 已存在 — 跳过生成"
    chmod 600 "$PROJECT_DIR/$DB_PASSWORD_FILE"
    exit 0
fi

info "生成 .secrets/db_password (48 字符 URL-safe)..."
gen_secret 48 > "$PROJECT_DIR/$DB_PASSWORD_FILE"
chmod 600 "$PROJECT_DIR/$DB_PASSWORD_FILE"
ok ".secrets/db_password 已写入 (chmod 600)"
info "  ⚠️  这个文件不可 commit (.gitignore 已含 .secrets/)"
info "  ⚠️  改这个密码会让现有 db 数据无法读 — 仅限首次部署"
