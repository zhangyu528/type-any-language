#!/bin/bash
#
# dev-host/env.sh — manage .env.dev on the development target host.
#
# One-time setup: copies .env.example.runtime → .env.dev (idempotent: skips
# if .env.dev exists) AND injects smart defaults so the resulting .env.dev
# is immediately usable. User can still edit .env.dev afterwards to
# override anything.
#
# Smart defaults injected (dev):
#   SECRET_KEY          random 48-char URL-safe
#   POSTGRES_PASSWORD   random 24-char URL-safe
#   ALLOWED_ORIGINS     http://localhost,http://localhost:3000
#                       (CRA dev server on :3000)
#
# NOT injected (decided elsewhere):
#   POSTGRES_USER, POSTGRES_DB    → baked into db image label, run.sh reads
#                                   via `docker inspect` at start time
#   DOCKER_REGISTRY, DB_IMAGE_TAG → run.sh / bake_image.sh read from
#                                   .env.cms on the CMS host
#
# If you also intend to do content work on this machine, run
# `scripts/ops/db/env.sh` to create .env.cms.
#
# Requires: shell + filesystem. NO python, NO docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

TEMPLATE=".env.example.runtime"
TARGET=".env.dev"

echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo -e "${_LIB_BLUE} type-any-language · dev env${_LIB_BLUE}"
echo -e "${_LIB_BLUE}=========================================${_LIB_BLUE}"
echo ""

# Idempotent: never overwrite an existing .env.dev.
if file_exists "$TARGET"; then
    ok "$TARGET 已存在（跳过）"
    info "  → 想重新生成请先 rm $TARGET"
    exit 0
fi

if ! file_exists "$TEMPLATE"; then
    err "$TEMPLATE 缺失 — 无法引导 $TARGET"
    exit 1
fi

# --- Step 1: copy template ------------------------------------------------
cp "$TEMPLATE" "$TARGET"
ok "已从 $TEMPLATE 复制为 $TARGET"

# --- Step 2: inject smart defaults (dev flavor) ---------------------------
# Honor overrides already set in the parent shell (CI / wrapper scripts).
SMART_SECRET=$(gen_secret 48)
SMART_PG_PASS=$(gen_secret 24)
SMART_ORIGINS="${ALLOWED_ORIGINS:-http://localhost,http://localhost:3000}"

# Backup before in-place edits so the user can roll back.
cp "$TARGET" "$TARGET.bak"

# Replace the change-me-* placeholders.
# Pipe-delimited pattern avoids escaping / in URL-safe secrets.
sed_inplace "s|^SECRET_KEY=change-me.*|SECRET_KEY=${SMART_SECRET}|" "$TARGET"
sed_inplace "s|^POSTGRES_PASSWORD=change-me.*|POSTGRES_PASSWORD=${SMART_PG_PASS}|" "$TARGET"
sed_inplace "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${SMART_ORIGINS}|" "$TARGET"

rm -f "$TARGET.bak"

# --- Step 3: show what was generated --------------------------------------
echo ""
ok "已注入 smart defaults（请检查/按需修改）:"
echo ""
grep -E "^(SECRET_KEY|POSTGRES_PASSWORD|ALLOWED_ORIGINS)=" \
    "$TARGET" | sed 's/^/  /'
echo ""
info "修改方式: nano $TARGET   (或 code $TARGET)"
echo ""
info "POSTGRES_USER / POSTGRES_DB 来自 baked db image 的 label (run.sh 自动读)"
info "DOCKER_REGISTRY / DB_IMAGE_TAG 由 CMS 主机 .env.cms 决定"