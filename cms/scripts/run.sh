#!/usr/bin/env bash
#
# cms/scripts/run.sh — drive the CMS side of ETL end-to-end (without
# the Load step). Equivalent to the old "pipeline.sh": runs every
# CMS-side step — staging-db ensure + E + T — and exits. The Load
# step (dbtools.importer) is db's job and runs as a separate command:
#
#   ./db/scripts/import_staging.sh all    ← this script does NOT call it
#
# What it does (in order):
#   (a) ensure a postgres source is reachable (container / local / fresh run)
#   (b) staging.sh sync        — vocab CSVs → cms/.local/staging/vocabulary/<lib>.json
#       (no db write — pure file producer)
#   (c) staging.sh sentences   — AI-fill → cms/.local/staging/sentences/<lib>.jsonl
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
# Keep this script free of db-side concerns so the cms ↔ db boundary is
# visible at the script-name level.
#
# Used by:
#   • scripts/dev-host/setup.sh — single-host CMS+dev auto-bake fallback
#     (only when the registry has no content-baked db image AND the host
#     has a cms/.env — see that script for context).
#   • CMS host operator — `./cms/scripts/run.sh` standalone after
#     editing CSVs / manifest / prompt, to refresh the staging files.
#
# Hard-fail on (a) / (b) / (c) — those only fail if the env is broken
# (no docker, no cms/.env, schema migration crash). Best-effort on (d) —
# depends on OpenAI / Tencent TTS external services that rate-limit or
# run out of quota. If (d) fails, log a warning and let the run proceed;
# the operator can re-run later once the external service is back.
#
# Exit codes:
#   0   all steps reached the end (audio may have warned)
#   1   hard failure on (a) / (b) / (c), OR cms/.env missing / doctor fail

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../scripts/lib.sh"

# cms/.env lives at the project root. This script is CMS-only — operators on
# a target host don't have it and shouldn't be calling this script.
CONTENT_ENV_FILE_PATH="$(resolve_content_env_file)"
if [ ! -f "$CONTENT_ENV_FILE_PATH" ]; then
    err "$CONTENT_ENV_FILE_PATH 不存在 — 先跑 ./cms/scripts/env.sh init 引导"
    exit 1
fi

# Path to the operator-managed db password file. Written by run.sh on first
# start, so a single-host CMS+dev setup already has it. A dedicated CMS host
# operator copies it via `scp` from the dev host (see CLAUDE.md).
SECRETS_DIR="${SECRETS_DIR:-$PROJECT_DIR/.secrets}"

# ---------------------------------------------------------------------------
# Helpers (CMS-only — moved out of dev-host/run.sh in the refactor)
# ---------------------------------------------------------------------------

# resolve_pg_password — print POSTGRES_PASSWORD (no trailing newline).
# Sources (in order): shell env > .secrets/postgres_password > cms/.env.
resolve_pg_password() {
    if [ -n "${POSTGRES_PASSWORD:-}" ]; then
        printf '%s' "$POSTGRES_PASSWORD"
        return 0
    fi
    if [ -f "$SECRETS_DIR/postgres_password" ]; then
        cat "$SECRETS_DIR/postgres_password"
        return 0
    fi
    if [ -f "$CONTENT_ENV_FILE_PATH" ]; then
        local pw
        pw="$(grep -E '^POSTGRES_PASSWORD=' "$CONTENT_ENV_FILE_PATH" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
        if [ -n "$pw" ]; then
            printf '%s' "$pw"
            return 0
        fi
    fi
    err "POSTGRES_PASSWORD 不可解析 — 在 cms/.env 里设 POSTGRES_PASSWORD=... 或"
    err "确保 $SECRETS_DIR/postgres_password 存在"
    return 1
}

# ensure_source_db — thin pass-through to db/scripts/source_db.sh
# (the db owns staging-db container lifecycle; CMS only consumes).
ensure_source_db() {
    "$PROJECT_DIR/db/scripts/source_db.sh" ensure
}

# run_staging_step <desc> <subcommand> [args...]
# Run a staging.sh subcommand (sync / sentences / audio) with progress logging. Returns 0/1.
run_staging_step() {
    local desc="$1"; shift
    info "  [staging.sh] $desc..."
    if ! "$SCRIPT_DIR/staging.sh" "$@"; then
        err "  [staging.sh] $desc 失败 (退出码 $?)"
        return 1
    fi
    ok "  [staging.sh] $desc ok"
    return 0
}

# ---------------------------------------------------------------------------
# doctor — cheap preflight, runs staging.sh doctor + checks POSTGRES_PASSWORD
# resolvable. Doesn't touch docker / network.
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

    if POSTGRES_PASSWORD="$(resolve_pg_password)" 2>/dev/null && [ -n "$POSTGRES_PASSWORD" ]; then
        ok "POSTGRES_PASSWORD 可解析"
    else
        err "POSTGRES_PASSWORD 不可解析 — 见上面 resolve_pg_password 的提示"
        ok=0
    fi

    if ! "$SCRIPT_DIR/staging.sh" doctor; then
        err "staging.sh doctor 失败"
        ok=0
    fi

    if ! require_docker 2>/dev/null; then
        err "docker 不可用 (run.sh 需要 docker 来起 staging db)"
        ok=0
    fi

    echo ""
    if [ "$ok" = "1" ]; then
        ok "所有检查通过 — 可以跑 ./cms/scripts/run.sh"
        return 0
    fi
    err "部分检查未通过"
    return 1
}

# ---------------------------------------------------------------------------
# run — the 5-step driver.
# ---------------------------------------------------------------------------
cmd_run() {
    # Resolve POSTGRES_PASSWORD (also exports it so staging.sh can read POSTGRES_*).
    POSTGRES_PASSWORD="$(resolve_pg_password)" || return 1
    export POSTGRES_PASSWORD

    # Source cms/.env so POSTGRES_USER/HOST/PORT/DB / AI_* / TENCENT_* / AUDIO_DIR resolve.
    set -a; . "$CONTENT_ENV_FILE_PATH"; set +a

    # (a) ensure source db.
    info "  (a) ensure source db"
    ensure_source_db || return 1

    # (b) vocab CSVs → staging JSON files (idempotent — skip-existing).
    #     The CMS pipeline no longer writes db directly. Output files
    #     land in cms/.local/staging/vocabulary/<lib>.json.
    run_staging_step "sync (CSVs → staging)" sync || return 1

    # (c) AI-fill sentences. Writes to cms/.local/staging/sentences/<lib>.jsonl.
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
    ok "  CMS driver 完成 — staging 文件已写到 cms/.local/staging/"
    info "  下一步 (db 端两个独立步骤):"
    info "    ./db/scripts/import_staging.sh all    # UPSERT staging 文件 → staging db"
    info "    ./db/scripts/build.sh                 # 烤 db image"
    return 0
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (无参数) | run    跑 CMS driver (ensure-db → sync → sentences → audio; 不含 L)
  doctor            prefight: cms/.env + POSTGRES_PASSWORD + staging.sh doctor + docker
  -h|--help|help    显示本帮助

典型工作流 (CMS 主机,三段独立步骤):
  ./cms/scripts/run.sh                     # (a) ensure-db + (b/c/d) E+T → cms/.local/staging/
  ./db/scripts/import_staging.sh all      # db: UPSERT staging 文件 → staging db (L)
  ./db/scripts/build.sh                    # db: pg_dump + docker build (bake)

调它的脚本:
  scripts/dev-host/setup.sh    # 单机 CMS+dev setup 时自动调用 (only when fallback)

注意:
  - sentences / audio 是 best-effort:外部 API 失败会 warn 但继续
  - ensure-db / sync 任何一步失败 → 整个脚本 fail (硬错)
  - 此脚本只在 CMS host 跑 (需要 cms/.env + POSTGRES_PASSWORD)
  - 此脚本不做 L 也不 bake — import_staging + build 各自独立跑
EOF
}

case "${1:-}" in
    ""|run)     cmd_run ;;
    doctor)     cmd_doctor ;;
    -h|--help|help)  usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac