#!/bin/bash
#
# ops/dev/db_drop.sh — drop dev dbs from the shared TencentDB instance.
#
# Useful for cleaning up after a feature branch has been merged and
# the per-branch dev db is no longer needed. Per-branch dbs accumulate
# (one per branch the developer has ever worked on), so this provides
# a manual cleanup path.
#
# Usage:
#   ./ops/dev/db_drop.sh english_dev_alice__feat_x     # drop one
#   ./ops/dev/db_drop.sh --list                         # list first (alias of db_list.sh)
#   ./ops/dev/db_drop.sh --all-untouched                # drop dbs whose git
#                                                         branch no longer
#                                                         exists in this
#                                                         working tree
#
# Safety:
#   - Refuses to drop databases that don't match `english_dev_<user>[__*]`
#     (operator cannot delete prod-db or another user's db by accident).
#   - Drops are non-recoverable. dbs hold developer-side staging data
#     (the cms/content/ files in git are the source of truth for content;
#     migrations in backend/migrations/ are the source of truth for schema).
#     Re-importing via `make dev-import-content` after a drop recreates
#     content from the working tree; running `lifecycle.sh restart` (or
#     `make dev-migrate`) re-runs migrations on the fresh db.
#
# Requires:
#   - .secrets/tencent_db_admin_url
#   - psql on PATH

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

# --- subcommand dispatch ---------------------------------------------------
case "${1:-}" in
    "")
        err "missing argument: db name to drop, or --list / --all-untouched"
        echo ""
        info "usage:"
        info "  $0 english_dev_<user>__<branch>      # drop one"
        info "  $0 --list                            # list user's dbs"
        info "  $0 --all-untouched                   # drop dbs with no matching git branch"
        exit 2
        ;;
    --list)
        exec "$SCRIPT_DIR/db_list.sh"
        ;;
    --all-untouched)
        echo ""
        warn "--all-untouched 会遍历你名下所有 dev dbs,找到后缀对应 git branch 不存在的,并 DROP"
        warn "这一动作不可逆 — 想清楚再继续"
        echo ""
        info "你名下的 dev dbs:"
        echo ""

        if [ -z "$USER_NAME" ]; then
            err "USER not set — cannot scope to one user. Pass --all-untouched=alice or similar, or set USER."
            exit 1
        fi

        PATTERN="english_dev_${USER_NAME}__"
        ALL_DBS="$(psql "$ADMIN_URL" -tA -c "
            SELECT datname FROM pg_database
            WHERE datname LIKE '$PATTERN' ORDER BY datname
        ")"

        if [ -z "$ALL_DBS" ]; then
            info "  (no per-branch dbs found for user=$USER_NAME)"
            exit 0
        fi

        # collect live branch / sha names once for matching
        LIVE_BRANCHES="$(git branch --format='%(refname:short)' 2>/dev/null \
            | sed -E 's|[^A-Za-z0-9_-]|_|g' \
            || true)"

        to_drop=()
        while IFS= read -r db; do
            [ -z "$db" ] && continue
            # Strip the prefix 'english_dev_<user>__' to get the suffix
            suffix="${db#english_dev_${USER_NAME}__}"
            # If the suffix matches a live git branch → keep
            if printf '%s\n' "$LIVE_BRANCHES" | grep -qx "$suffix"; then
                info "  keep   $db  (branch $suffix alive locally)"
            else
                warn "  drop?  $db  (branch '$suffix' not found)"
                to_drop+=("$db")
            fi
        done <<< "$ALL_DBS"

        if [ "${#to_drop[@]}" -eq 0 ]; then
            info ""
            info "nothing to drop"
            exit 0
        fi

        warn ""
        warn "打算 DROP 上面 ${#to_drop[@]} 个 db。继续吗? (yes / no)"
        read -r ans
        case "$ans" in
            yes|y|Y) ;;
            *) info "aborted"; exit 0 ;;
        esac

        # Disconnect any active connections, then drop.
        for db in "${to_drop[@]}"; do
            psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = '$db' AND pid <> pg_backend_pid()
            " >/dev/null
            psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$db\""
            ok "dropped $db"
        done
        exit 0
        ;;
    --help|-h)
        sed -n '2,28p' "$0"
        exit 0
        ;;
    *)
        # Single-name drop
        TARGET="$1"

        # Reject anything that doesn't look like a dev db.
        if [[ "$TARGET" != english_dev_* ]]; then
            err "refusing to drop '$TARGET': not an english_dev_* db"
            err "  只 DROP 你 user 名下的 dev db (防止误删 prod)"
            exit 1
        fi

        # If USER is set and the target doesn't belong to this user, refuse.
        if [ -n "$USER_NAME" ] && [[ "$TARGET" != "english_dev_${USER_NAME}"* ]]; then
            err "refusing to drop '$TARGET': user=$USER_NAME 不是 owner"
            err "  只 DROP 自己 user 名下的 dev db"
            exit 1
        fi

        # Check it actually exists.
        EXISTS="$(psql "$ADMIN_URL" -tAc "
            SELECT 1 FROM pg_database WHERE datname='$TARGET'
        " 2>/dev/null || echo "")"
        if [ "$EXISTS" != "1" ]; then
            err "db '$TARGET' 不存在 (or admin DSN can't reach)"
            exit 1
        fi

        warn ""
        warn "打算 DROP: $TARGET"
        warn "这一动作不可逆。db 里的 schema + content 都会清掉(从 git working tree 重灌即可)"
        read -p "继续吗? [y/N] " ans
        case "$ans" in
            [Yy]|[Yy][Ee][Ss]) ;;
            *) info "aborted"; exit 0 ;;
        esac

        psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = '$TARGET' AND pid <> pg_backend_pid()
        " >/dev/null
        psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$TARGET\""
        ok "dropped $TARGET"

        info ""
        info "重建(下次 lifecycle start / make dev-migrate 会自动建):"
        info "  ./ops/dev/setup.sh bootstrap    # 等价 dbtools 重建 + migrations"
        info "  ./ops/dev/import_content.sh    # 重灌 content(从 cms/content/)"
        exit 0
        ;;
esac