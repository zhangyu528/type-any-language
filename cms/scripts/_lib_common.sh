#!/usr/bin/env bash
#
# cms/scripts/_lib_common.sh — shared helpers for cms/scripts/*.sh.
#
# 集中放所有 cms-side 脚本都用得到的小 helper:
#   - ok / warn / err / info (彩色 / [OK]/[WARN]/[ERR]/[INFO] 前缀)
#   - py_cmd: 解析 python 解释器 (python3 优先,fallback python)
#   - project_root: 返回仓库根
#   - usage_template: 标准 usage 头
#
# 用法(任何 cmd_*.sh 顶部):
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/_lib_common.sh"
#
# 设计原则:source-only,无副作用 (除 export 颜色变量)。
#
# 历史:之前这里曾经驻留过 _check_env_group / _check_tencent_*
# / _check_python_deps / cmd_doctor,合在 _lib_preflight.sh 里被
# run.sh doctor 入口调用。cms/.env 退役 + doctor 改用 bootstrap.sh
# 之后,preflight 整个下线 —— 现在的 Python 依赖检查只用在
# run.sh 入口的 5 行 gate_python_deps,extras 检查只在
# bootstrap.sh 内部。预检逻辑跟着消费点走,不再有集中 doctor 模块。

set -e

# ---------------------------------------------------------------------------
# 颜色 — TTY 时启用
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    _LC_GREEN='\033[0;32m'
    _LC_YELLOW='\033[1;33m'
    _LC_RED='\033[0;31m'
    _LC_BLUE='\033[0;34m'
    _LC_NC='\033[0m'
else
    _LC_GREEN=''; _LC_YELLOW=''; _LC_RED=''; _LC_BLUE=''; _LC_NC=''
fi

ok()   { echo -e "${_LC_GREEN}[OK]${_LC_NC}   $1"; }
warn() { echo -e "${_LC_YELLOW}[WARN]${_LC_NC} $1"; }
info() { echo -e "${_LC_BLUE}[INFO]${_LC_NC} $1"; }
err()  { echo -e "${_LC_RED}[ERR]${_LC_NC}  $1" >&2; }

# ---------------------------------------------------------------------------
# project_root — caller 用 SCRIPT_DIR 算出 (此文件被 source 时
# ${BASH_SOURCE[0]} 是 _lib_common.sh 自己,所以独立计算)
# 注:用 git rev-parse 而不是 `cd ../..` —— 后者在 Git Bash on Windows
# 下会因 `..` 段吞掉 hyphenated 路径段(已踩过坑,见 cms/run.sh)。
# ---------------------------------------------------------------------------
project_root() {
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    git -C "$here" rev-parse --show-toplevel
}

# ---------------------------------------------------------------------------
# py_cmd — 优先 python3,fallback python。返回非空字符串即可执行。
# ---------------------------------------------------------------------------
py_cmd() {
    if command -v python3 >/dev/null 2>&1; then
        echo python3
        return 0
    fi
    if command -v python >/dev/null 2>&1; then
        echo python
        return 0
    fi
    return 1
}

# ---------------------------------------------------------------------------
# require_python — 没有 python 时友好报错后 exit 1
# ---------------------------------------------------------------------------
require_python() {
    if ! py_cmd >/dev/null 2>&1; then
        err "未发现 python3 / python — CMS host 需要装 Python 3.11+"
        err "  (Windows: 装 pyenv-win + pyenv install 3.11;Linux: apt install python3)"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# usage_label — 标准 usage 顶头 (被 staging.sh 的总 usage 使用)
# 单一来源:任何 cmd_*.sh 都不应自己拼这段
# ---------------------------------------------------------------------------
staging_usage_body() {
    cat <<EOF
用法: $0 <command>

命令:
  vocab         csv → cms/content/vocabulary/<lib>.json (E: Extract)
  sentences  调 OpenAI 追加句子到 cms/content/sentences/<lib>.jsonl (T: Transform)
  audio      调 Tencent TTS 烤 MP3,更新 audio_url 字段 (T: Transform; 跳过已设的)
  -h|--help    显示本帮助

注意:export 子命令已退役 — db/scripts/export_bundle.py 不再存在,
内容直接通过 db/scripts/import_staging.sh UPSERT 到云 db,不再走
pg_dump → dump.sql → image 的 bake 链路。
EOF
}
