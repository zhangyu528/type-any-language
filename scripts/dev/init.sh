#!/bin/bash
#
# dev/init.sh — first-time env setup for development hosts.
#
# Copies .env.example.runtime → .env.dev (idempotent: skips if .env.dev exists)
# AND injects "smart defaults" so the resulting .env.dev is immediately
# usable. User can still edit .env.dev afterwards to override anything.
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
# `scripts/cms/env.sh` to create .env.cms.
#
# Two ways to get the dev images up:
#   A. With registry (recommended for new dev onboarding):
#      - ./scripts/dev/run.sh start    # auto-pulls db + backend + frontend
#
#   B. Local build (offline / no registry):
#      - ./scripts/dev/build_image.sh       # build backend + frontend
#      - (if you also do content work)
#        edit .env.cms: DB_IMAGE_TAG=dev
#        ./scripts/cms/bake_image.sh        # bake the db image
#      - ./scripts/dev/run.sh start
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

echo -e "${_LIB_BLUE}=========================================${_LIB_NC}"
echo -e "${_LIB_BLUE} type-any-language · dev init${_LIB_NC}"
echo -e "${_LIB_BLUE}=========================================${_LIB_NC}"
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

# Use a portable sed that works on both GNU and BSD (macOS) variants.
sed_inplace() {
    # $1 = pattern, $2 = file
    if sed --version >/dev/null 2>&1; then
        sed -i "$1" "$2"
    else
        sed -i '' "$1" "$2"
    fi
}

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
echo "下一步 (任选一条路):"
echo ""
echo -e "  ${_LIB_BLUE}A. 走 registry (推荐):${_LIB_NC}"
echo -e "     ${_LIB_BLUE}./scripts/dev/run.sh start${_LIB_NC}    # auto-pull db + backend + frontend"
echo ""
echo -e "  ${_LIB_BLUE}B. 本地 build (离线 / 无 registry):${_LIB_NC}"
echo -e "     ${_LIB_BLUE}./scripts/dev/build_image.sh${_LIB_NC}"
echo "     # (如果也做内容): 编辑 .env.cms: DB_IMAGE_TAG=dev"
echo -e "     ${_LIB_BLUE}./scripts/cms/bake_image.sh${_LIB_NC}"
echo -e "     ${_LIB_BLUE}./scripts/dev/run.sh start${_LIB_NC}"
