#!/usr/bin/env bash
#
# cmd_audio.sh — audio: 调 Tencent TTS 烤 MP3,更新 sentences.audio_url (T: Transform)
#
# 薄壳 over python -m cms_pipeline.generate_audio。flags 全透传。
# 读 cms/content/sentences/<lib>.jsonl,对 audio_url 为空的行调 Tencent TTS,
# 上传到 Storage(默认 CLOUD_PROVIDER=local_fs 写 cms/.local/audio/;
# tencent_cos 走 CLOUD_* 凭据上传到 COS bucket)。
#
# 前置:
#   TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID (all-or-nothing)
#   CLOUD_* 仅在 CLOUD_PROVIDER != local_fs 时才需要
# 失败出口仍在 Python 的 cfg.require_tencent() / cfg.require_cloud()。
#
# 用法:
#   ./cms/scripts/cmd_audio.sh             # 处理全部 lib 的 audio_url 为空的行
#   ./cms/scripts/cmd_audio.sh --lib ielts # 仅 ielts
#   ./cms/scripts/cmd_audio.sh --force     # 全部重烤 (即便 audio_url 已有)
#   ./cms/scripts/cmd_audio.sh --help      # 看 python 模块的 argparse 帮助

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

source "$SCRIPT_DIR/_lib_common.sh"
require_python

usage() {
    cat <<EOF
用法: cmd_audio.sh [--lib <name>...] [--force] [--help]

Tencent TTS 调 → 写 audio_url 到 cms/content/sentences/<lib>.jsonl  (T: Transform)

薄壳 over python -m cms_pipeline.generate_audio。flags 全透传。

前置 (来自 fetch_secrets.sh eval-cms 或 shell export):
  TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID  (all-or-nothing)
  CLOUD_* 仅在 CLOUD_PROVIDER != local_fs 时必填

被 cms/run.sh 与 cms/scripts/staging.sh 调用;可单独跑。

EOF
}

case "${1:-}" in
    -h|--help|help|"") usage; exit 0 ;;
esac

exec "$SCRIPT_DIR/py-run.sh" cms_pipeline.generate_audio "$@"
