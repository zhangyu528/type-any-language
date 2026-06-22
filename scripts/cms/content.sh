#!/bin/bash
#
# db/content.sh — orchestrate the content production pipeline.
#
# Subcommands (all idempotent; safe to re-run):
#   sync       Import vocabulary CSVs → vocabulary_libs / vocabulary_words.
#              (pipeline/import_vocab.py)
#   sentences  Bulk-generate practice sentences via OpenAI.
#              (pipeline/generate_sentences.py)
#   audio      Bulk-generate MP3s via Tencent Cloud TTS.
#              (pipeline/generate_audio.py)
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
#   ./scripts/db/content.sh sync        # csv → DB
#   ./scripts/db/content.sh sentences   # OpenAI fills buckets
#   ./scripts/db/content.sh audio       # Tencent TTS fills mp3s
#   ./scripts/db/content.sh export      # (optional) inspect staging bundle
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

# pipeline/ lives at db/pipeline/. For `python -m pipeline.X`
# to work, db/ must be on PYTHONPATH.
export PYTHONPATH="${PROJECT_DIR}/db${PYTHONPATH:+:$PYTHONPATH}"

# Pick a python interpreter. Lazy: only resolved when a subcommand actually
# needs it. This way `content.sh -h` and `content.sh` (usage) work even on
# hosts without python3 (e.g. on a target host that only needs prod/dev
# scripts, not CMS).
py() { py_cmd; }


# ---------------------------------------------------------------------------
# cmd_doctor — pre-flight checks before any subcommand.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== db/content.sh pre-flight ==="
    echo ""

    if [ ! -f .env.cms ]; then
        err ".env.cms 不存在 — 跑 ./scripts/cms/env.sh 先引导"
        return 1
    fi
    ok ".env.cms 存在"

    # Source .env.cms quietly to peek at required keys.
    set -a; . ./.env.cms; set +a

    # Hard requirements (every subcommand needs these).
    local missing=()
    [ -z "$DATABASE_URL" ]   && missing+=("DATABASE_URL")
    [ -z "$AI_API_KEY" ]     && missing+=("AI_API_KEY")
    [ -z "$AUDIO_DIR" ]      && missing+=("AUDIO_DIR")

    if [ ${#missing[@]} -gt 0 ]; then
        err "以下 .env.cms key 缺失:"
        for k in "${missing[@]}"; do echo "  - $k"; done
        ok=0
    else
        ok "核心 .env.cms key 都有值 (DATABASE_URL / AI_API_KEY / AUDIO_DIR)"
    fi

    # TENCENT_* — all-or-nothing, but 0 is OK (only audio subcommand needs them).
    local t_count=0
    [ -n "$TENCENT_SECRET_ID" ]  && t_count=$((t_count + 1))
    [ -n "$TENCENT_SECRET_KEY" ] && t_count=$((t_count + 1))
    [ -n "$TENCENT_APP_ID" ] && [ "$TENCENT_APP_ID" != "0" ] && t_count=$((t_count + 1))
    case "$t_count" in
        0) warn "TENCENT_* 都没填 — audio 子命令会失败, sentences 仍可工作" ;;
        3) ok "TENCENT_* 三件套齐全" ;;
        *) err "TENCENT_* 部分设置 (${t_count}/3) — 必须 all-or-nothing"
           ok=0 ;;
    esac

    # Python deps — check via a quick import. Skip if no python3 at all.
    local py
    if py="$(py_cmd 2>/dev/null)"; then
        if ! "$py" -c "import psycopg2, openai" 2>/dev/null; then
            err "Python 依赖缺失 (psycopg2 / openai)"
            info "  → pip install psycopg2-binary openai"
            info "  → (Tencent SDK 在 audio 子命令跑的时候才需要)"
            ok=0
        else
            ok "Python deps (psycopg2, openai) 已装"
        fi
    else
        warn "未发现 python3 — 跳过 Python 依赖检查"
        info "  → CMS host 需要装 python3 + pip install psycopg2-binary openai"
        ok=0
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
    "$(py)" -m pipeline.import_vocab "$@"
}

cmd_sentences() {
    "$(py)" -m pipeline.generate_sentences "$@"
}

cmd_audio() {
    "$(py)" -m pipeline.generate_audio "$@"
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
    "$(py)" -m pipeline.export_bundle "$@"
}

usage() {
    cat <<EOF
用法: $0 <command> [args]

命令:
  sync       把 db/content/vocabulary/*.csv 灌进 vocabulary_libs / vocabulary_words
  sentences  调 OpenAI 批量生成 sentences (填到 DEFAULT_BUCKET_TARGET_SIZE)
  audio      调 Tencent TTS 批量烤 MP3 (跳过 audio_url 已设的句子)
  publish    no-op (schema 没有 published 标志)
  export     把 content + audio 导出成 staging bundle (bake_image 内部用的同一个)
  doctor     前置检查 (.env.cms + Python deps + db 可达)
  -h|help    显示本帮助

每个子命令都透传给 db/pipeline/ 下的 Python 模块。子命令自身的
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
    doctor)     cmd_doctor || exit 1 ;;
    sync)       shift; cmd_sync "$@" ;;
    sentences)  shift; cmd_sentences "$@" ;;
    audio)      shift; cmd_audio "$@" ;;
    publish)    cmd_publish ;;
    export)     shift; cmd_export "$@" ;;
    -h|--help|help|"") usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac