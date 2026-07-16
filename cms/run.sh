#!/usr/bin/env bash
#
# cms/run.sh — drive the CMS side of ETL end-to-end (without
# the Load step). Equivalent to the old "pipeline.sh": runs every
# CMS-side step (E + T) and exits. The Load step (dbtools.importer)
# is db's job and runs as a separate command:
#
#   ./db/scripts/import_staging.sh all    ← this script does NOT call it
#
# What it does (in order):
#   (a) [removed in the db-decoupling refactor] — staging-db ensure
#       used to live here but was redundant: db/scripts/import_staging.sh
#       idempotently ensures the staging db itself (db/scripts/source_db.sh
#       ensure), so CMS no longer needs to pre-empt it.
#   (b) staging.sh sync        — vocab CSVs → cms/staging/vocabulary/<lib>.json
#       (no db write — pure file producer)
#   (c) staging.sh sentences   — AI-fill → cms/staging/sentences/<lib>.jsonl
#       (best-effort — skipped if AI_* unset, warn-on-fail)
#   (d) staging.sh audio       — TTS-fill → updates audio_url in the same sentences JSONL
#       (best-effort — skipped if TENCENT_* unset, warn-on-fail)
#
# Notably absent BOTH: Load (db/scripts/import_staging.sh) and bake
# (db/scripts/build.sh). Both are db's responsibility and run as separate
# operator commands. After run.sh exits:
#
#   ./db/scripts/import_staging.sh all   # L: UPSERT staging files → staging db
#   ./db/scripts/build.sh                # bake: pg_dump → docker build
#
# CMS-side modules do NOT connect to the database — they only write
# files. POSTGRES_PASSWORD is therefore NOT needed by this script (or
# any cms_pipeline.* Python module). The db side (db/scripts/source_db.sh
# / build.sh / migrate.sh) resolves the password itself from shell env or
# .secrets/postgres_password.
#
# Keep this script free of db-side concerns so the cms ↔ db boundary is
# visible at the script-name level.
#
# Used by:
#   • CMS host operator — `./cms/run.sh` standalone after editing CSVs /
#     manifest / prompt, to refresh the staging files.
#
# Hard-fail on (b) — that only fails if the env is broken (no cms/.env).
# Best-effort on (c) / (d) — depends on OpenAI / Tencent TTS external
# services that rate-limit or run out of quota. If either fails, log a
# warning and let the run proceed; the operator can re-run later once the
# external service is back.
#
# Exit codes:
#   0   all steps reached the end (sentences / audio may have warned)
#   1   hard failure on (b), OR cms/.env missing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../scripts/lib.sh"

# cms/.env lives at the project root. This script is CMS-only — operators on
# a target host don't have it and shouldn't be calling this script.
CONTENT_ENV_FILE_PATH="$(resolve_content_env_file)"
if [ ! -f "$CONTENT_ENV_FILE_PATH" ]; then
    err "$CONTENT_ENV_FILE_PATH 不存在 — 先跑 ./cms/scripts/env.sh init 引导"
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers (CMS-only)
# ---------------------------------------------------------------------------

# run_staging_step <desc> <subcommand> [args...]
# Run a staging.sh subcommand (sync / sentences / audio) with progress logging. Returns 0/1.
run_staging_step() {
    local desc="$1"; shift
    info "  [staging.sh] $desc..."
    if ! "$SCRIPT_DIR/scripts/staging.sh" "$@"; then
        err "  [staging.sh] $desc 失败 (退出码 $?)"
        return 1
    fi
    ok "  [staging.sh] $desc ok"
    return 0
}

# ---------------------------------------------------------------------------
# doctor — cheap preflight. Only checks cms/.env present + docker (for
# reference, in case the operator also plans to run db scripts). Doesn't
# touch the network.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== run.sh pre-flight ==="
    echo ""

    if [ -f "$CONTENT_ENV_FILE_PATH" ]; then
        ok "$CONTENT_ENV_FILE_PATH 存在"
    else
        err "$CONTENT_ENV_FILE_PATH 不存在 — 先跑 ./cms/scripts/env.sh init"
        ok=0
    fi

    if ! "$SCRIPT_DIR/scripts/staging.sh" doctor; then
        err "staging.sh doctor 失败"
        ok=0
    fi

    echo ""
    if [ "$ok" = "1" ]; then
        ok "所有检查通过 — 可以跑 ./cms/run.sh"
        return 0
    fi
    err "部分检查未通过"
    return 1
}

# ---------------------------------------------------------------------------
# run — the 3-step driver (E + T only).
# ---------------------------------------------------------------------------
cmd_run() {
    # Source cms/.env so AI_* / TENCENT_* / CLOUD_* / AUDIO_DIR resolve for
    # the Python subcommands. NOTE: POSTGRES_PASSWORD is intentionally NOT
    # sourced here — CMS modules don't connect to the db.
    set -a; . "$CONTENT_ENV_FILE_PATH"; set +a

    # (b) vocab CSVs → staging JSON files (idempotent — skip-existing).
    #     The CMS pipeline no longer writes db directly. Output files
    #     land in cms/staging/vocabulary/<lib>.json.
    run_staging_step "sync (CSVs → staging)" sync || return 1

    # (c) AI-fill sentences. Writes to cms/staging/sentences/<lib>.jsonl.
    #     Best-effort: AI_* missing → skip; API fails → warn and continue.
    if [ -n "${AI_API_KEY:-}" ] && [ -n "${AI_BASE_URL:-}" ] && [ -n "${AI_MODEL:-}" ]; then
        run_staging_step "sentences (AI-fill → JSONL)" sentences || \
            warn "  sentences 失败 — 跳过 (runtime 起来后 /api/sentences 会返回空)"
    else
        warn "  跳过 sentences (AI_API_KEY / AI_BASE_URL / AI_MODEL 没设齐)"
    fi

    # (d) TTS audio. Reads sentences JSONL, fills audio_url in-place.
    #     All-or-nothing: any TENCENT_* missing → skip.
    if [ -n "${TENCENT_SECRET_ID:-}" ] && [ -n "${TENCENT_SECRET_KEY:-}" ] && \
       [ -n "${TENCENT_APP_ID:-}" ]; then
        run_staging_step "audio (TTS-fill → JSONL)" audio || \
            warn "  audio 失败 — 跳过 (sentences.audio_url 没填 /audio/<hash>.mp3 会 404)"
    else
        warn "  跳过 audio (TENCENT_* 没填齐)"
    fi

    # NOTE: Load (db/scripts/import_staging.sh) is NOT here on purpose —
    # it's db's responsibility and runs separately. See header doc.
    ok "  CMS driver 完成 — staging 文件已写到 cms/staging/"
    info "  下一步 (db 端两个独立步骤):"
    info "    ./db/scripts/import_staging.sh all    # UPSERT staging 文件 → staging db"
    info "    ./db/scripts/build.sh                 # 烤 db image"
    return 0
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (无参数) | run    跑 CMS driver (sync → sentences → audio; 不含 L)
  doctor            prefight: cms/.env + staging.sh doctor
  -h|--help|help    显示本帮助

典型工作流 (CMS 主机,三段独立步骤):
  ./cms/run.sh                     # E+T → cms/staging/
  ./db/scripts/import_staging.sh all      # db: UPSERT staging 文件 → staging db (L)
  ./db/scripts/build.sh                    # db: pg_dump + docker build (bake)

注意:
  - sentences / audio 是 best-effort:外部 API 失败会 warn 但继续
  - sync 任何一步失败 → 整个脚本 fail (硬错)
  - 此脚本只在 CMS host 跑 (需要 cms/.env 托管 AI/TENCENT/CLOUD 密钥)
  - 此脚本不做 L 也不 bake — import_staging + build 各自独立跑
  - 此脚本不需要 POSTGRES_PASSWORD —— CMS 模块不连 db
EOF
}

case "${1:-}" in
    ""|run)     cmd_run ;;
    doctor)     cmd_doctor ;;
    -h|--help|help)  usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac