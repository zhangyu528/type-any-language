#!/usr/bin/env bash
#
# cmd_export.sh — pass-through to db/scripts/export_bundle.py。
#
# 此 sub-command 是为 muscle memory 保留的入口。真正的 SQL dump 工作
# 在 db 段 (db/scripts/export_bundle.py 调 pg_dump 写出 dump.sql,
# db/scripts/build.sh 再 cat 那个 sql 烤 image)。
#
# 我们不让 CMS 写 db,所以 export 只做"穿透":把 args 透传给 db 工具。
#
# 用法:
#   ./cms/scripts/cmd_export.sh --help            # 看 db/scripts/export_bundle.py 帮助
#   ./cms/scripts/cmd_export.sh --keep-staging    # 例如

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

source "$SCRIPT_DIR/_lib_common.sh"
require_python

usage() {
    cat <<EOF
用法: cmd_export.sh [<args for db/scripts/export_bundle.py>]

Pass-through to db/scripts/export_bundle.py (CMS 不写 db, export 是 db 的职责)。

CMS 这一步只做"肌肉记忆兼容": ./cms/scripts/staging.sh export 仍然可用,
但实际活儿在 db 那边。flags 全部透传 — 'cmd_export.sh --help' 看 db 端帮助。

EOF
}

case "${1:-}" in
    -h|--help|help|"") usage; exit 0 ;;
esac

exec "$SCRIPT_DIR/py-run.sh" "$PROJECT_DIR/db/scripts/export_bundle.py" "$@"
