#!/bin/bash
#
# cms/content.sh — orchestrate the content production pipeline.
#
# Subcommands (all idempotent; safe to re-run):
#   sync       Import vocabulary CSVs → vocabulary_libs / vocabulary_words.
#              (data_pipeline/import_vocab.py)
#   sentences  Bulk-generate practice sentences via OpenAI.
#              (data_pipeline/generate_sentences.py)
#   audio      Bulk-generate MP3s via Tencent Cloud TTS.
#              (data_pipeline/generate_audio.py)
#   publish    Mark the current snapshot ready for bake (no-op for now —
#              schema has no published_at column; this is a documentation
#              hook for future use).
#   export     Dump content + audio into a staging bundle (same as
#              what bake_image.sh does internally — exposed here for
#              inspection).
#   doctor     Pre-flight: .env.cms ready, py deps present, db reachable.
#   -h|help    Show usage.
#
# Typical workflow (CMS host):
#   ./scripts/cms/content.sh sync        # csv → DB
#   ./scripts/cms/content.sh sentences   # OpenAI fills buckets
#   ./scripts/cms/content.sh audio       # Tencent TTS fills mp3s
#   ./scripts/cms/content.sh export      # (optional) inspect staging bundle
#   ./scripts/cms/bake_image.sh          # build image
#   ./scripts/cms/push_image.sh          # ship to registry
#
# Each subcommand just wraps the underlying python module. Pass `--help`
# to the wrapped CLI for the full flag list.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../lib.sh"

# data_pipeline/ lives at cms/data_pipeline/. For `python -m data_pipeline.X`
# to work, cms/ must be on PYTHONPATH.
export PYTHONPATH="${PROJECT_DIR}/cms${PYTHONPATH:+:$PYTHONPATH}"

# Pick a python interpreter. lib.sh's py_cmd prints the chosen one.
PY="$(py_cmd)"


# ---------------------------------------------------------------------------
# cmd_doctor — pre-flight checks before any subcommand.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== cms/content.sh pre-flight ==="
    echo ""

    if [ ! -f .env.cms ]; then
        err ".env.cms 不存在 — 跑 ./scripts/cms/env.sh 先引导"
        return 1
    fi
    ok ".env.cms 存在"

    # Source .env.cms quietly to peek at required keys.
    set -a; . ./.env.cms; set +a

    local missing=()
    [ -z "$DATABASE_URL" ]            && missing+=("DATABASE_URL")
    [ -z "$AI_API_KEY" ]              && missing+=("AI_API_KEY")
    [ -z "$TENCENT_SECRET_ID" ]       && missing+=("TENCENT_SECRET_ID")
    [ -z "$TENCENT_SECRET_KEY" ]      && missing+=("TENCENT_SECRET_KEY")
    [ -z "$TENCENT_APP_ID" ]          && missing+=("TENCENT_APP_ID")
    [ -z "$AUDIO_DIR" ]               && missing+=("AUDIO_DIR")

    if [ ${#missing[@]} -gt 0 ]; then
        err "以下 .env.cms key 缺失:"
        for k in "${missing[@]}"; do echo "  - $k"; done
        ok=0
    else
        ok "所有 required .env.cms key 都有值"
    fi

    # Python deps — check via a quick import.
    if ! "$PY" -c "import psycopg2, openai" 2>/dev/null; then
        err "Python 依赖缺失 (psycopg2 / openai)"
        info "  → pip install psycopg2-binary openai"
        info "  → (Tencent SDK 在 audio 子命令跑的时候才需要)"
        ok=0
    else
        ok "Python deps (psycopg2, openai) 已装"
    fi

    # DB reachability.
    if command -v psql &>/dev/null && [ -n "$DATABASE_URL" ]; then
        if psql "$DATABASE_URL" -tAc "SELECT 1" &>/dev/null; then
            ok "DATABASE_URL 可连接"
        else
            err "DATABASE_URL 不可连接"
            ok=0
        fi
    fi

    echo ""
    if [ "$ok" = "1" ]; then
        ok "所有检查通过 — 可以跑 sync / sentences / audio"
        return 0
    else
        err "部分检查未通过"
        return 1
    fi
}

cmd_sync() {
    "$PY" -m data_pipeline.import_vocab "$@"
}

cmd_sentences() {
    "$PY" -m data_pipeline.generate_sentences "$@"
}

cmd_audio() {
    "$PY" -m data_pipeline.generate_audio "$@"
}

cmd_publish() {
    # No-op for now. The current schema has no "published" flag — sentences
    # are baked once, served forever. If/when we add a published_at column
    # or a per-sentence status field, wire it here.
    info "publish: no-op (schema 没有 published 标志 — sentences 烤进去即最终态)"
    info "  下一步: ./scripts/cms/bake_image.sh"
}

cmd_export() {
    # The actual staging-bundle export is done by bake_image.sh. This
    # subcommand just exposes it standalone so you can inspect the bundle
    # without re-baking.
    "$PY" -m data_pipeline.export_bundle "$@"
}

usage() {
    cat <<EOF
用法: $0 <command> [args]

命令:
  sync       把 cms/content/vocabulary/*.csv 灌进 vocabulary_libs / vocabulary_words
  sentences  调 OpenAI 批量生成 sentences (填到 DEFAULT_BUCKET_TARGET_SIZE)
  audio      调 Tencent TTS 批量烤 MP3 (跳过 audio_url 已设的句子)
  publish    no-op (schema 没有 published 标志)
  export     把 content + audio 导出成 staging bundle (bake_image 内部用的同一个)
  doctor     前置检查 (.env.cms + Python deps + db 可达)
  -h|help    显示本帮助

每个子命令都透传给 cms/data_pipeline/ 下的 Python 模块。子命令自身的
参数透传，flags 见各自 --help:
  $0 sync --help
  $0 sentences --help
  $0 audio --help

典型工作流:
  $0 sync              # csv → DB
  $0 sentences         # OpenAI 填句子
  $0 audio             # TTS 烤 MP3
  ./scripts/cms/bake_image.sh    # 烤 image
  ./scripts/cms/push_image.sh    # 推 registry
EOF
}

case "${1:-}" in
    doctor)     cmd_doctor ;;
    sync)       shift; cmd_sync "$@" ;;
    sentences)  shift; cmd_sentences "$@" ;;
    audio)      shift; cmd_audio "$@" ;;
    publish)    cmd_publish ;;
    export)     shift; cmd_export "$@" ;;
    -h|--help|help|"") usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac