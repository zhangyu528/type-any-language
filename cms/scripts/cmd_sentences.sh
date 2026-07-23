#!/usr/bin/env bash
#
# cmd_sentences.sh — sentences: 调 OpenAI 追加句子到 JSONL  (T: Transform)
#
# 薄壳 over python -m cms_pipeline.generate_sentences。flags 全透传。
# 读取 cms/content/vocabulary/<lib>.json 后,调 OpenAI 填到 bucket 大小
# (默认 DEFAULT_BUCKET_TARGET_SIZE=200),追加到
# cms/content/sentences/<lib>.jsonl。
#
# 前置:AI_API_KEY / AI_BASE_URL / AI_MODEL 三个 env var 必须存在。
# 失败时 doctor 会打印这条;
# 直接跑本脚本(不 eval-cms),用 cfg.require_ai() 在 Python 内部统一出口。
#
# 用法:
#   ./cms/scripts/cmd_sentences.sh             # 全部 lib
#   ./cms/scripts/cmd_sentences.sh --lib ielts # 仅 ielts
#   ./cms/scripts/cmd_sentences.sh --help      # 看 python 模块的 argparse 帮助

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

source "$SCRIPT_DIR/_lib_common.sh"
require_python

usage() {
    cat <<EOF
用法: cmd_sentences.sh [--lib <name>...] [--target-size N] [--incremental] [--help]

OpenAI 调 → cms/content/sentences/<lib>.jsonl  (T: Transform)

薄壳 over python -m cms_pipeline.generate_sentences。flags 全透传。

前置 (来自 fetch_secrets.sh eval-cms 或 shell export):
  AI_API_KEY / AI_BASE_URL / AI_MODEL

被 cms/run.sh 与 cms/scripts/staging.sh 调用;可单独跑。

EOF
}

case "${1:-}" in
    -h|--help|help|"") usage; exit 0 ;;
esac

# AI_* 凭据校验由 cms_pipeline.generate_sentences._read_ai_cfg()
# 在 load_config() + cfg.require_ai() 处做,失败时 sys.exit(1) + 中文 hint。

exec "$SCRIPT_DIR/py-run.sh" cms_pipeline.generate_sentences "$@"
