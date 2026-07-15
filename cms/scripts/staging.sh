#!/bin/bash
#
# cms/scripts/staging.sh — produce the CMS staging files (E+T only;
# never opens a db connection).
#
# This script is the file-producer half of the CMS pipeline. All outputs
# land in cms/.local/staging/ — naming matches `db/scripts/import_staging.sh`
# which reads those files in the Load step.
#
# E: Extract
#   sync       Import vocabulary CSVs → cms/.local/staging/vocabulary/<lib>.json.
#              (cms/cms_pipeline/import_vocab.py)
# T: Transform
#   sentences  Bulk-generate practice sentences via OpenAI →
#              cms/.local/staging/sentences/<lib>.jsonl (append).
#              (cms/cms_pipeline/generate_sentences.py)
#   audio      Bulk-generate MP3s via Tencent Cloud TTS →
#              updates audio_url in the same sentences JSONL.
#              (cms/cms_pipeline/generate_audio.py)
# L: Load
#   (NOT here. The Load step is db/scripts/import_staging.sh + dbtools.importer
#    — a separate db-side operator command. cms/run.sh wraps
#    (a) ensure-db + (b/c/d) the steps here, but doesn't do L either.)
#
# Subcommands here for parity:
#   export     Pass-through to db/scripts/export_bundle.py — the db's
#              pg_dump entry point. Exposed as `staging.sh export` for
#              muscle memory; the actual code lives at db/scripts/.
#   doctor     Pre-flight: cms/.env ready, py deps present.
#   -h|help    Show usage.
#
# Typical workflow (CMS host) — the three operator commands:
#   ./cms/scripts/staging.sh sync         # csv → cms/.local/staging/vocabulary/<lib>.json
#   ./cms/scripts/staging.sh sentences    # OpenAI → cms/.local/staging/sentences/<lib>.jsonl
#   ./cms/scripts/staging.sh audio        # TTS → updates audio_url in same JSONL
#   ./cms/run.sh                  # full CMS driver (ensure-db + the 3 above)
#   ./db/scripts/import_staging.sh all    # db: UPSERT staging 文件 → staging db
#   ./db/scripts/build.sh                 # db: bake db image from staging db
#   ./db/scripts/push.sh                  # ship to registry
#
# Each subcommand just wraps the underlying python module. Pass `--help`
# to the wrapped CLI for the full flag list.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../scripts/lib.sh"

# cms/data-pipeline modules (import_vocab, generate_sentences,
# generate_audio) live at cms/cms_pipeline/. The schema / migrations
# live at db/tools/dbtools/. Both packages have to coexist on
# PYTHONPATH (so `python -m cms_pipeline.X` for data pipeline and
# both work) — the
# package names are different so they don't shadow each other.
export PYTHONPATH="${PROJECT_DIR}/cms:${PROJECT_DIR}/db/tools${PYTHONPATH:+:$PYTHONPATH}"

# Force Python IO to UTF-8 so Unicode glyphs in pipeline output (✓ / ✗
# / box-drawing in import_vocab / generate_sentences / generate_audio /
# export_bundle summaries) don't blow up on Windows consoles whose
# default codepage is GBK / cp936. No-op on macOS / Linux.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# Pick a python interpreter. Lazy: only resolved when a subcommand actually
# needs it. This way `staging.sh -h` and `staging.sh` (usage) work even on
# hosts without python3 (e.g. on a target host that only needs prod/dev
# scripts, not CMS).
py() { py_cmd; }


# ---------------------------------------------------------------------------
# cmd_doctor — pre-flight checks before any subcommand.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== staging.sh pre-flight ==="
    echo ""

    local env_file
    env_file="$(resolve_content_env_file)"
    if [ ! -f "$env_file" ]; then
        err "$env_file 不存在 — 跑 ./cms/scripts/env.sh 先引导"
        return 1
    fi
    ok "$env_file 存在"

    # Source cms/.env quietly to peek at required keys.
    set -a; . "$env_file"; set +a

    # Hard requirements (every subcommand needs these).
    # DATABASE_URL is NOT in cms/.env — it's assembled from POSTGRES_PASSWORD
    # + code defaults. AUDIO_DIR is also NOT in cms/.env (code default
    # /var/lib/type-any-language/audio). AI_BASE_URL / AI_MODEL ARE in
    # cms/.env (operator decisions — OpenAI vs Azure vs local, gpt-3.5-turbo
    # vs gpt-4o). The check below mirrors what cms/cms_pipeline/env.py does in
    # Python; we replicate it here in bash so doctor can run without
    # spinning up Python.
    local missing=()
    [ -z "$AI_API_KEY" ]     && missing+=("AI_API_KEY")
    [ -z "$AI_BASE_URL" ]    && missing+=("AI_BASE_URL")
    [ -z "$AI_MODEL" ]       && missing+=("AI_MODEL")
    if [ -z "$DATABASE_URL" ]; then
        # Try to assemble it (same logic as env.py / db/scripts/build.sh).
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
        err "以下 cms/.env / 必要项缺失:"
        for k in "${missing[@]}"; do echo "  - $k"; done
        ok=0
    else
        ok "核心 key 都有值 (AI_API_KEY / AI_BASE_URL / AI_MODEL / POSTGRES_PASSWORD)"
    fi

    # AUDIO_DIR: code default, just show what's resolved (no fail if missing —
    # staging.sh audio will mkdir -p when it runs). The default lives inside
    # the project (cms/.local/audio) so Windows / sandboxed Linux hosts
    # can run audio without setting anything.
    local _audio_dir="${AUDIO_DIR:-cms/.local/audio}"
    if [ -d "$_audio_dir" ]; then
        ok "AUDIO_DIR=$_audio_dir  (目录存在)"
    else
        info "AUDIO_DIR=$_audio_dir  (目录不存在, staging.sh audio 会自动 mkdir)"
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
    "$(py)" -m cms_pipeline.import_vocab "$@"
}

cmd_sentences() {
    "$(py)" -m cms_pipeline.generate_sentences "$@"
}

cmd_audio() {
    "$(py)" -m cms_pipeline.generate_audio "$@"
}

cmd_publish() {
    # Removed: the schema has no "published" flag (sentences are baked
    # once, served forever) so this command was always a no-op. Kept as
    # a friendly error so older docs / muscle memory don't silently do
    # nothing.
    err "publish 子命令已移除 — schema 没有 published 标志"
    err "  直接跑: ./db/scripts/build.sh"
    exit 1
}

cmd_export() {
    # Delegate to db/scripts/export_bundle.py — the db image's own
    # SQL-dump entry point. CMS used to host export_bundle.py, but
    # it's now a db concern (the file lands in db-image/init/, which
    # is db's build input). This subcommand is a thin pass-through so
    # operators who learned `staging.sh export` still have an entry
    # point without learning the new db/scripts/ path.
    "$(py)" "$PROJECT_DIR/db/scripts/export_bundle.py" "$@"
}

usage() {
    cat <<EOF
用法: $0 <command> [args]

命令:
  sync         把 cms/source/vocabulary/*.csv 写到 cms/.local/staging/vocabulary/<lib>.json (E: Extract)
  sentences  调 OpenAI 追加句子到 cms/.local/staging/sentences/<lib>.jsonl (T: Transform)
  audio      调 Tencent TTS 烤 MP3,更新 audio_url 字段 (T: Transform; 跳过已设的)
  export       pass-through to db/scripts/export_bundle.py(为 muscle memory 留的)
  doctor       前置检查 (cms/.env + Python deps)
  -h|help      显示本帮助

每个子命令都透传给 cms/cms_pipeline/ 下的 Python 模块。子命令自身的
参数透传，flags 见各自 --help:
  $0 sync --help
  $0 sentences --help
  $0 audio --help

注意:本脚本从**不**连 DB。DB 端通过 db/scripts/import_staging.sh
(dbtools.importer) 把 staging 文件 UPSERT 进 staging db。典型工作流:
  $0 sync                                   # CMS: csv → JSON
  $0 sentences                              # CMS: OpenAI → JSONL
  $0 audio                                  # CMS: TTS → 填 audio_url
  ./db/scripts/import_staging.sh all       # db: 灌 staging 文件
  ./db/scripts/build.sh            # db: 烤 image
  ./db/scripts/push.sh            # db: 推 registry
  # 或者上面 3 步一次性: ./cms/run.sh + ./db/scripts/build.sh
EOF
}

case "${1:-}" in
    doctor)        cmd_doctor || exit 1 ;;
    sync)          shift; cmd_sync "$@" ;;
    sentences)     shift; cmd_sentences "$@" ;;
    audio)         shift; cmd_audio "$@" ;;
    publish)       cmd_publish ;;
    export)        shift; cmd_export "$@" ;;
    -h|--help|help|"") usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac