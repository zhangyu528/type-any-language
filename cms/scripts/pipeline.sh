#!/usr/bin/env bash
#
# cms/scripts/pipeline.sh — orchestrate the CMS content-production
# pipeline end-to-end. Lives here (not in dev-host/run.sh) because every
# step is a CMS-side concern — vocab CSVs, AI/TTS calls.
#
# What it does (in order):
#   (a) ensure a postgres source is reachable (container / local / fresh run)
#   (b) import vocab CSVs → cms/.local/staging/vocabulary/<lib>.json
#       (no db write — the CMS pipeline produces files only)
#   (c) AI-fill sentences → cms/.local/staging/sentences/<lib>.jsonl
#       (best-effort — skipped if AI_* unset, warn-on-fail)
#   (d) TTS-fill audio → updates audio_url in the same sentences JSONL
#       (best-effort — skipped if TENCENT_* unset, warn-on-fail)
#   (e) db/scripts/import_staging.sh — reads the staging files and
#       UPSERTs into vocabulary_libs / vocabulary_words / sentences.
#       This step is on db/scripts/ because the db schema is db's
#       concern; the CMS pipeline only knows about files.
#
# Notably absent: db image bake. That's db/scripts/build.sh's job — see
# the cms/scripts/full_bake.sh one-liner wrapper at the same path if you
# want both in a single command. The pipeline here writes content; the
# image bake reads it. Keeping these as two scripts (with an optional
# wrapper) makes it clear where CMS responsibility ends and db's begins.
#
# Used by:
#   • scripts/dev-host/setup.sh — single-host CMS+dev auto-bake fallback
#     (only when the registry has no content-baked db image AND the host
#     has a cms/.env — see that script for context).
#   • CMS host operator — `./cms/scripts/pipeline.sh` standalone after
#     editing CSVs / manifest / prompt, to fill the staging db.
#   • For a full pipeline-then-bake in one command, use the
#     full_bake.sh wrapper at the same path.
#
# Hard-fail on (a) / (b) / (c) — those should only fail if the env is
# broken (no docker, no cms/.env, schema migration crash). Best-effort on
# (d) / (e) — those depend on external services (OpenAI / Tencent TTS) that
# rate-limit or run out of quota. If they fail, log loud warnings and let
# the pipeline proceed with whatever content sync produced. The operator
# can re-run later once the external service is back, and the db image
# bake (a separate script) will pick up the now-populated sentences /
# audio fields.
#
# Exit codes:
#   0   all steps reached the end (sentences / audio may have warned)
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

# run_content_step <desc> <subcommand> [args...]
# Run a content.sh subcommand with progress logging. Returns 0/1.
run_content_step() {
    local desc="$1"; shift
    info "  [content.sh] $desc..."
    if ! "$SCRIPT_DIR/content.sh" "$@"; then
        err "  [content.sh] $desc 失败 (退出码 $?)"
        return 1
    fi
    ok "  [content.sh] $desc ok"
    return 0
}

# ---------------------------------------------------------------------------
# doctor — cheap preflight, runs content.sh doctor + checks POSTGRES_PASSWORD
# resolvable. Doesn't touch docker / network.
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "=== full_bake.sh pre-flight ==="
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

    if ! "$SCRIPT_DIR/content.sh" doctor; then
        err "content.sh doctor 失败"
        ok=0
    fi

    if ! require_docker 2>/dev/null; then
        err "docker 不可用 (full_bake 需要 docker)"
        ok=0
    fi

    echo ""
    if [ "$ok" = "1" ]; then
        ok "所有检查通过 — 可以跑 ./cms/scripts/full_bake.sh"
        return 0
    fi
    err "部分检查未通过"
    return 1
}

# ---------------------------------------------------------------------------
# run — the 6-step pipeline.
# ---------------------------------------------------------------------------
cmd_run() {
    # Resolve POSTGRES_PASSWORD (also exports it so content.sh + bake can read).
    POSTGRES_PASSWORD="$(resolve_pg_password)" || return 1
    export POSTGRES_PASSWORD

    # Source cms/.env so POSTGRES_USER/HOST/PORT/DB / AI_* / TENCENT_* / AUDIO_DIR resolve.
    set -a; . "$CONTENT_ENV_FILE_PATH"; set +a

    # (a) ensure source db.
    info "  (a) ensure source db"
    ensure_source_db || return 1

    # (b) vocab CSVs → staging JSON files (idempotent — skip-existing).
    #     The CMS pipeline no longer writes db directly. Output files
    #     land in cms/.local/staging/vocabulary/<lib>.json. The db side
    #     imports them via db/scripts/import_staging.sh.
    run_content_step "sync (CSVs → staging)" sync || return 1

    # (c) AI-fill sentences. Writes to cms/.local/staging/sentences/<lib>.jsonl.
    #     Best-effort: AI_* missing → skip; API fails → warn and continue.
    if [ -n "${AI_API_KEY:-}" ] && [ -n "${AI_BASE_URL:-}" ] && [ -n "${AI_MODEL:-}" ]; then
        run_content_step "sentences (AI-fill → JSONL)" sentences || \
            warn "  sentences 失败 — 跳过 (runtime 起来后 /api/sentences 会返回空)"
    else
        warn "  跳过 sentences (AI_API_KEY / AI_BASE_URL / AI_MODEL 没设齐)"
    fi

    # (d) TTS audio. Reads sentences JSONL, fills audio_url in-place.
    #     All-or-nothing: any TENCENT_* missing → skip.
    if [ -n "${TENCENT_SECRET_ID:-}" ] && [ -n "${TENCENT_SECRET_KEY:-}" ] && \
       [ -n "${TENCENT_APP_ID:-}" ]; then
        run_content_step "audio (TTS-fill → JSONL)" audio || \
            warn "  audio 失败 — 跳过 (sentences.audio_url 没填 /audio/<hash>.mp3 会 404)"
    else
        warn "  跳过 audio (TENCENT_* 没填齐)"
    fi

    # (e) db import. Reads staging files written by (b)/(c)/(d) and
    #     UPSERTs into vocabulary_libs / vocabulary_words / sentences.
    #     Idempotent — re-runs skip existing rows.
    info "  (e) import staging → db"
    if "$PROJECT_DIR/db/scripts/import_staging.sh" all; then
        ok "  import_staging ok"
    else
        err "  import_staging 失败 — 看上面错误"
        return 1
    fi

    ok "  pipeline 完成 — 内容已写到 staging db"
    info "  下一步 (separate step, db 的职责):"
    info "    ./db/scripts/build.sh         # 烤 db image"
    return 0
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (无参数) | run    跑完整 CMS pipeline (ensure-db → sync → sentences → audio → import_staging)
  doctor            prefight: cms/.env + POSTGRES_PASSWORD + content.sh doctor + docker
  -h|--help|help    显示本帮助

典型工作流:
  # 首次 / 改 CSV 后 / 改 prompt 后:
  ./cms/scripts/pipeline.sh                # 跑完整 CMS pipeline
  ./db/scripts/build.sh                    # 单独跑 db image bake(独立步骤)
  # 或者: ./cms/scripts/full_bake.sh        # 上面两行一气呵成(wrapper)

调它的脚本:
  scripts/dev-host/setup.sh    # 单机 CMS+dev setup 时自动调用 (only when fallback)

注意:
  - sentences / audio 是 best-effort:外部 API 失败会 warn 但继续
  - ensure-db / init-schema / sync 任何一步失败 → 整个脚本 fail (硬错)
  - 此脚本只在 CMS host 跑 (需要 cms/.env + POSTGRES_PASSWORD)
  - 此脚本不 bake db image — 那是 db/scripts/build.sh 的事
EOF
}

case "${1:-}" in
    ""|run)     cmd_run ;;
    doctor)     cmd_doctor ;;
    -h|--help|help)  usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac