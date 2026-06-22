#!/bin/bash
#
# prod/init.sh — first-time env setup for production hosts.
#
# Copies .env.example.runtime → .env (idempotent: skips if .env exists)
# AND injects "smart defaults" so the resulting .env is immediately
# usable. User can still edit .env afterwards to override anything.
#
# Smart defaults injected (prod):
#   SECRET_KEY          random 48-char URL-safe
#   POSTGRES_PASSWORD   random 24-char URL-safe
#   ALLOWED_ORIGINS     http://localhost
#
# NOT injected (decided elsewhere):
#   POSTGRES_USER, POSTGRES_DB    → baked into db image label, run.sh reads
#                                   via `docker inspect` at start time
#   DOCKER_REGISTRY, DB_IMAGE_TAG → run.sh / bake_image.sh read from
#                                   .env.cms on the CMS host
#
# This is the only env file a prod host needs. AI / TTS 凭据 in .env.cms
# are NOT needed here — the runtime is a pure read layer, and the
# content-baked db image carries all the content.
#
# Next:
#   # (optional) edit .env to override any smart default
#   ./scripts/ops/prod-host/build_image.sh
#   ./scripts/ops/prod-host/run.sh start
#
# Requires: shell + filesystem. NO python, NO docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

TEMPLATE=".env.example.runtime"
TARGET=".env"

echo -e "${_LIB_BLUE}=========================================${_LIB_NC}"
echo -e "${_LIB_BLUE} type-any-language · prod init${_LIB_NC}"
echo -e "${_LIB_BLUE}=========================================${_LIB_NC}"
echo ""

# Idempotent: never overwrite an existing .env.
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

# --- Step 2: inject smart defaults ----------------------------------------
# Honor overrides already set in the parent shell (CI / wrapper scripts).
#   ALLOWED_ORIGINS=... ./scripts/ops/prod-host/env.sh    → uses that origins
SMART_SECRET=$(gen_secret 48)
SMART_PG_PASS=$(gen_secret 24)
SMART_ORIGINS="${ALLOWED_ORIGINS:-http://localhost}"

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
echo ""
echo "下一步:"
echo -e "  ${_LIB_BLUE}./scripts/ops/prod-host/build_image.sh${_LIB_NC}"
echo -e "  ${_LIB_BLUE}./scripts/ops/prod-host/run.sh start${_LIB_NC}"
