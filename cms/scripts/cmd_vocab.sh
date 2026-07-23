#!/usr/bin/env bash
#
# cmd_vocab.sh — vocab sync: CSVs → cms/content/vocabulary/<lib>.json  (E: Extract)
#
# 薄壳 over python -m cms_pipeline.import_vocab。flags 全透传。
# 这是 cms/run.sh 里唯一一个"硬依赖"步骤:sentences / audio 是 best-effort,
# vocabulary 必须先生成才能 feed sentences / audio。
#
# vocab 不调 API(OpenAI / TTS),不连 db。所以不需要 AI_*/TENCENT_* 凭据 —
# 唯一前置是 cms/seed/vocabulary/*.csv 存在。doctor 不强制要求 env。
#
# 用法:
#   ./cms/scripts/cmd_vocab.sh               # 处理全部 lib (默认)
#   ./cms/scripts/cmd_vocab.sh --lib ielts   # 仅 ielts
#   ./cms/scripts/cmd_vocab.sh --help        # 看 python 模块的帮助

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

source "$SCRIPT_DIR/_lib_common.sh"
require_python

usage() {
    cat <<EOF
用法: cmd_vocab.sh [--lib <name>...] [--help]

CSVs → cms/content/vocabulary/<lib>.json  (E: Extract)

薄壳 over python -m cms_pipeline.import_vocab。flags 全透传。
被 cms/run.sh 与 cms/scripts/staging.sh 调用;可单独跑。

EOF
}

case "${1:-}" in
    -h|--help|help) usage; exit 0 ;;
esac

# 不调 API — 无须 fetch_secrets.sh eval-cms。
# 关键:"$@" 展开后如果只有空 positional 会被 argparse 误当作 args.lib = ""，
# 落到 get_lib("") 然后报 lib 不存在。所以无 args 时不传 positional,
# 让 import_vocab 走 default=None 的"全 lib"分支(看 import_vocab.py:209-212)。
if [ $# -eq 0 ]; then
    exec "$SCRIPT_DIR/py-run.sh" cms_pipeline.import_vocab
else
    exec "$SCRIPT_DIR/py-run.sh" cms_pipeline.import_vocab "$@"
fi
