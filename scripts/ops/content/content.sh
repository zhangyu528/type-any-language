#!/bin/bash
#
# scripts/ops/content/content.sh — orchestrate the content production pipeline.
#
# Subcommands (all idempotent; safe to re-run):
#   init-schema Run pending schema migrations + create_all safety net
#              (cms/init_schema.py -> cms.migrations.upgrade_head).
#   sync       Import vocabulary CSVs → vocabulary_libs / vocabulary_words.
#              (pipeline/import_vocab.py)
#   sentences  Bulk-generate practice sentences via OpenAI.
#              (pipeline/generate_sentences.py)
#   audio      Bulk-generate MP3s via Tencent Cloud TTS.
#              (pipeline/generate_audio.py)
#   export     Dump content + audio into a staging bundle (same as
#              what bake_image.sh does internally — exposed here for
#              inspection).
#   doctor     Pre-flight: .env.db ready, py deps present, db reachable.
#   -h|help    Show usage.
#
# Typical workflow (CMS host):
#   ./scripts/ops/content/content.sh sync        # csv → DB
#   ./scripts/ops/content/content.sh sentences   # OpenAI fills buckets
#   ./scripts/ops/content/content.sh audio       # Tencent TTS fills mp3s
#   ./scripts/ops/content/content.sh export      # (optional) inspect staging bundle
#   ./scripts/ops/content/bake_image.sh          # build image
#   ./scripts/ops/content/push_image.sh          # ship to registry
#
# Each subcommand just wraps the underlying python module. Pass `--help`
# to the wrapped CLI for the full flag list.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"

# cms/ lives at content/tools/cms/. For `python -m cms.X` to work,
# content/tools/ must be on PYTHONPATH.
export PYTHONPATH="${PROJECT_DIR}/content/tools${PYTHONPATH:+:$PYTHONPATH}"

# Force Python IO to UTF-8 so Unicode glyphs in pipeline output (✓ / ✗
# / box-drawing in import_vocab / generate_sentences / generate_audio /
# export_bundle summaries) don't blow up on Windows consoles whose
# default codepage is GBK / cp936. No-op on macOS / Linux.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

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

    echo "=== content.sh pre-flight ==="
    echo ""

    if [ ! -f .env.db ]; then
        err ".env.db 不存在 — 跑 ./scripts/ops/content/env.sh 先引导"
        return 1
    fi
    ok ".env.db 存在"

    # Source .env.db quietly to peek at required keys.
    set -a; . ./.env.db; set +a

    # Hard requirements (every subcommand needs these).
    # DATABASE_URL is NOT in .env.db — it's assembled from POSTGRES_PASSWORD
    # + code defaults. AUDIO_DIR is also NOT in .env.db (code default
    # /var/lib/type-any-language/audio). AI_BASE_URL / AI_MODEL ARE in
    # .env.db (operator decisions — OpenAI vs Azure vs local, gpt-3.5-turbo
    # vs gpt-4o). The check below mirrors what content/tools/cms/env.py does in
    # Python; we replicate it here in bash so doctor can run without
    # spinning up Python.
    local missing=()
    [ -z "$AI_API_KEY" ]     && missing+=("AI_API_KEY")
    [ -z "$AI_BASE_URL" ]    && missing+=("AI_BASE_URL")
    [ -z "$AI_MODEL" ]       && missing+=("AI_MODEL")
    if [ -z "$DATABASE_URL" ]; then
        # Try to assemble it (same logic as env.py / bake_image.sh).
        local _pu="${POSTGRES_USER:-english_user}"
        local _pd="${POSTGRES_DB:-english_learning}"
        local _ph="${POSTGRES_HOST:-localhost}"
        local _pp="${POSTGRES_PORT:-5432}"
        local _pp_pw="${POSTGRES_PASSWORD:-}"
        if [ -z "$_pp_pw" ] && [ -f .secrets/postgres_password ]; then
            _pp_pw="$(cat .secrets/postgres_password)"
        fi
        if [ -n "$_pp_pw" ]; then
            DATABASE_URL="postgresql://${_pu}:${_pp_pw}@${_ph}:${_pp}/${_pd}"
        else
            missing+=("POSTGRES_PASSWORD (or .secrets/postgres_password)")
        fi
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        err "以下 .env.db / 必要项缺失:"
        for k in "${missing[@]}"; do echo "  - $k"; done
        ok=0
    else
        ok "核心 key 都有值 (AI_API_KEY / AI_BASE_URL / AI_MODEL / POSTGRES_PASSWORD)"
    fi

    # AUDIO_DIR: code default, just show what's resolved (no fail if missing —
    # content.sh audio will mkdir -p when it runs).
    local _audio_dir="${AUDIO_DIR:-/var/lib/type-any-language/audio}"
    if [ -d "$_audio_dir" ]; then
        ok "AUDIO_DIR=$_audio_dir  (目录存在)"
    else
        info "AUDIO_DIR=$_audio_dir  (目录不存在, content.sh audio 会自动 mkdir)"
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
    "$(py)" -m cms.import_vocab "$@"
}

cmd_init_schema() {
    "$(py)" -m cms.init_schema "$@"
}

cmd_sentences() {
    "$(py)" -m cms.generate_sentences "$@"
}

cmd_audio() {
    "$(py)" -m cms.generate_audio "$@"
}

cmd_publish() {
    # Removed: the schema has no "published" flag (sentences are baked
    # once, served forever) so this command was always a no-op. Kept as
    # a friendly error so older docs / muscle memory don't silently do
    # nothing.
    err "publish 子命令已移除 — schema 没有 published 标志"
    err "  直接跑: ./scripts/ops/content/bake_image.sh"
    exit 1
}

cmd_export() {
    # The actual staging-bundle export is done by bake_image.sh. This
    # subcommand just exposes it standalone so you can inspect the bundle
    # without re-baking.
    "$(py)" -m cms.export_bundle "$@"
}

usage() {
    cat <<EOF
用法: $0 <command> [args]

命令:
  init-schema  运行 pending schema migrations + create_all 兜底 (一次性, 幂等)
  sync         把 content/source/vocabulary/*.csv 灌进 vocabulary_libs / vocabulary_words
  sentences  调 OpenAI 批量生成 sentences (填到 DEFAULT_BUCKET_TARGET_SIZE)
  audio      调 Tencent TTS 批量烤 MP3 (跳过 audio_url 已设的句子)
  export       把 content + audio 导出成 staging bundle (bake_image 内部用的同一个)
  doctor       前置检查 (.env.db + Python deps + db 可达)
  -h|help      显示本帮助

每个子命令都透传给 content/tools/cms/ 下的 Python 模块。子命令自身的
参数透传，flags 见各自 --help:
  $0 sync --help
  $0 sentences --help
  $0 audio --help

典型工作流 (CMS 主机,首次):
  ./scripts/ops/content/env.sh                   # .env.db 引导 (一次性)
  $0 init-schema                            # migrations + create_all 兜底 (一次性, 幂等)
  $0 sync                                   # csv → DB
  $0 sentences                              # OpenAI 填句子
  $0 audio                                  # TTS 烤 MP3
  ./scripts/ops/content/bake_image.sh            # 烤 image
  ./scripts/ops/content/push_image.sh            # 推 registry
EOF
}

case "${1:-}" in
    doctor)        cmd_doctor || exit 1 ;;
    init-schema)   shift; cmd_init_schema "$@" ;;
    sync)          shift; cmd_sync "$@" ;;
    sentences)     shift; cmd_sentences "$@" ;;
    audio)         shift; cmd_audio "$@" ;;
    publish)       cmd_publish ;;
    export)        shift; cmd_export "$@" ;;
    -h|--help|help|"") usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac