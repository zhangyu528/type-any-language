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
#   (b) cms/scripts/cmd_vocab.sh         — CSVs → cms/staging/vocabulary/<lib>.json
#       (硬依赖 — 失败则整个 driver 退出 1)
#   (c) cms/scripts/cmd_sentences.sh    — AI-fill → cms/staging/sentences/<lib>.jsonl
#       (best-effort — 缺 AI_* 则 skip; API 失败 → warn 但继续)
#   (d) cms/scripts/cmd_audio.sh        — TTS-fill → 更新 audio_url
#       (best-effort — 缺 TENCENT_* 则 skip; TTS 失败 → warn 但继续)
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
# 历史:旧 staging.sh vocab / sentences / audio 入口被拆分到
# cms/scripts/cmd_*.sh。run.sh 现在直接 exec 这三个 cmd_*.sh(不走
# cms/scripts/staging.sh dispatcher),这样错误码、信号传播更干净。
#
# Used by:
#   • CMS host operator — `./cms/run.sh` standalone after editing CSVs /
#     manifest / prompt, to refresh the staging files.
#
# Sub-step semantics:
#   (b) vocab      — hard fail. Doesn't need any keys.
#   (c) sentences  — hard fail if AI_* env missing (run.sh is "run the
#                    whole pipeline"; silent skip would mislead).
#   (d) audio      — hard fail if TENCENT_* env missing. Same.
# Operators who only want vocab run cmd_vocab.sh directly — it has no
# env check, since vocab doesn't need AI_*/TENCENT_*.
#
# NOT called by the dev host. Dev hosts run a different on-demand
# pipeline — `./ops/dev/setup.sh content` — which deliberately skips
# (c)/(d) and only does the db-side import+bake+restart loop. See the
# dev-host section of CLAUDE.md for the dev side's content-refresh
# command. This script's audience is genuinely CMS-only: any host that
# has access to the upstream repo's GH Environment secrets and is willing
# to spend API quota on content generation.
#
# Pre-flight: bootstrap.sh (one-time) does fetch_secrets.sh check
# (gh / auth / repo) and prints the eval line for the operator to
# run. After bootstrap, the operator's interactive shell has AI_*/
# TENCENT_* in env, and run.sh trusts that. The only entry-time gate
# left in run.sh is `gate_python_deps` (openai + PyYAML importable),
# which catches the "new shell, didn't run bootstrap yet" case.
#
# Exit codes:
#   0   all steps reached the end (sentences / audio may have warned
#       on network errors, but env was set)
#   1   hard failure — vocab fail / gate_python_deps fail / AI_* or
#       TENCENT_* env missing / sentences or audio subprocess fail

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Project root resolution. Two routes both have Git Bash on Windows
# quirks that bit us previously:
#   (a) `cd "$SCRIPT_DIR/../.."` — `..` resolution eats a hyphenated
#       segment (e.g. `type-any-language`), landing one level too high.
#   (b) `$(dirname $(dirname "$SCRIPT_DIR"))` — nested `$(...)` inside
#       a single command substitution mis-parses, so only the inner
#       dirname takes effect.
# `git rev-parse --show-toplevel` walks `.git` upward, doesn't use
# `..` resolution, and is unaffected by either bug.
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../ops/lib.sh"

# CMS configuration is supplied by the process environment via:
#   eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"

# ---------------------------------------------------------------------------
# Helpers (CMS-only)
# ---------------------------------------------------------------------------

# run_step <desc> <script-path> [args...]
# Run a CMS-side step (a cmd_*.sh) with progress logging. Returns its exit code.
run_step() {
    local desc="$1"; shift
    info "  [cms] $desc..."
    if ! "$@"; then
        err "  [cms] $desc 失败 (退出码 $?)"
        return 1
    fi
    ok "  [cms] $desc ok"
    return 0
}

# ---------------------------------------------------------------------------
# gate_python_deps — entry-time check that base Python deps are
# importable. Catches operators who skipped bootstrap.sh (or whose
# venv isn't activated). Not a substitute for the full bootstrap
# flow — it doesn't check the optional [audio] / [cos] extras,
# because cmd_sentences / cmd_audio have their own "missing extras
# → skip / error" behavior, and the entry gate's job is only to
# catch the "nothing will run" case.
# ---------------------------------------------------------------------------
gate_python_deps() {
    local py
    if ! py="$(py_cmd 2>/dev/null)"; then
        err "未发现 python3 — CMS host 需要装 Python 3.11+"
        info "  → 装好后跑: ./cms/scripts/bootstrap.sh"
        return 1
    fi
    local missing=()
    "$py" -c "import openai" 2>/dev/null || missing+=("openai")
    "$py" -c "import yaml"   2>/dev/null || missing+=("PyYAML")
    if [ ${#missing[@]} -eq 0 ]; then
        return 0
    fi
    err "Python 依赖缺失: ${missing[*]}"
    info "  → 装: ./cms/scripts/bootstrap.sh"
    info "  → 或: pip install -e \"./cms[audio,cos]\""
    return 1
}

# ---------------------------------------------------------------------------
# run — the 3-step driver (E + T only).
#
# Two hard pre-flight gates at entry:
#   1. fetch_secrets.sh check is NOT here on purpose — bootstrap.sh does
#      it once per CMS host setup, and operators inject the secrets
#      into the current shell via
#          eval "$(./scripts/secrets/fetch_secrets.sh eval-cms)"
#      before running this script. run.sh then trusts the env is there.
#   2. gate_python_deps — openai + PyYAML importable. Catches operators
#      who skipped bootstrap.sh (or whose venv isn't activated).
#
# Sub-step semantics (3-step):
#   (b) vocab      — hard fail. Doesn't need any keys.
#   (c) sentences  — hard fail. Needs AI_*. Hard-fails the WHOLE script
#                    if any of AI_API_KEY / AI_BASE_URL / AI_MODEL is
#                    missing — `run.sh` default entry is "run the
#                    whole pipeline", and silently skipping sentences
#                    would leave the operator thinking they ran the
#                    pipeline when they didn't. Operators who only
#                    want vocab run cmd_vocab.sh directly.
#   (d) audio      — hard fail. Same reasoning. Needs TENCENT_*.
# ---------------------------------------------------------------------------
cmd_run() {
    # Entry gate: Python deps. See gate_python_deps for why only base,
    # not [audio] / [cos].
    if ! gate_python_deps; then
        return 1
    fi

    # (b) vocab CSVs → staging JSON files (idempotent — skip-existing).
    #     The CMS pipeline no longer writes db directly. Output files
    #     land in cms/staging/vocabulary/<lib>.json.
    run_step "vocab (CSVs → staging JSON)" \
        "$SCRIPT_DIR/scripts/cmd_vocab.sh" || return 1

    # (c) AI-fill sentences. Writes to cms/staging/sentences/<lib>.jsonl.
    #     Hard fail if AI_* env is missing — see cmd_run() header for
    #     why. Best-effort is only for the *API call* (network errors
    #     warn but continue so partial work isn't lost), not for env.
    if [ -z "${AI_API_KEY:-}" ] || [ -z "${AI_BASE_URL:-}" ] || [ -z "${AI_MODEL:-}" ]; then
        err "  sentences 缺 AI_* env,run.sh 退出"
        err "    缺: $([ -z "${AI_API_KEY:-}" ] && echo AI_API_KEY; [ -z "${AI_BASE_URL:-}" ] && echo AI_BASE_URL; [ -z "${AI_MODEL:-}" ] && echo AI_MODEL | tr '\n' ' ')"
        info "  → 注入密钥: eval \"\$(./scripts/secrets/fetch_secrets.sh eval-cms)\""
        info "  → 只跑 vocab(不需 AI_*)用: ./cms/scripts/cmd_vocab.sh"
        return 1
    fi
    run_step "sentences (AI-fill → JSONL)" \
        "$SCRIPT_DIR/scripts/cmd_sentences.sh" || \
        warn "  sentences 失败 — 跳过 (runtime 起来后 /api/sentences 会返回空)"

    # (d) TTS audio. Reads sentences JSONL, fills audio_url in-place.
    #     All-or-nothing: any TENCENT_* missing → hard fail. Same
    #     reasoning as sentences — silent skip would mislead.
    if [ -z "${TENCENT_SECRET_ID:-}" ] || [ -z "${TENCENT_SECRET_KEY:-}" ] || \
       [ -z "${TENCENT_APP_ID:-}" ]; then
        err "  audio 缺 TENCENT_* env,run.sh 退出"
        err "    缺: $([ -z "${TENCENT_SECRET_ID:-}" ] && echo TENCENT_SECRET_ID; [ -z "${TENCENT_SECRET_KEY:-}" ] && echo TENCENT_SECRET_KEY; [ -z "${TENCENT_APP_ID:-}" ] && echo TENCENT_APP_ID | tr '\n' ' ')"
        info "  → 注入密钥: eval \"\$(./scripts/secrets/fetch_secrets.sh eval-cms)\""
        info "  → 只跑 vocab(不需 TENCENT_*)用: ./cms/scripts/cmd_vocab.sh"
        return 1
    fi
    run_step "audio (TTS-fill → JSONL)" \
        "$SCRIPT_DIR/scripts/cmd_audio.sh" || \
        warn "  audio 失败 — 跳过 (sentences.audio_url 没填 /audio/<hash>.mp3 会 404)"

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
  (无参数) | run    跑 CMS driver (vocab → sentences → audio; 不含 L)
  -h|--help|help    显示本帮助

典型工作流 (CMS 主机,四段独立步骤):
  ./cms/scripts/bootstrap.sh                       # 一次性:装 deps + 验 gh/auth + 打印 eval 行
  eval "\$(./scripts/secrets/fetch_secrets.sh eval-cms)"   # 注入 AI/TENCENT/CLOUD 密钥
  ./cms/run.sh                                     # E+T → cms/staging/
  ./db/scripts/import_staging.sh all               # db: UPSERT staging 文件 → staging db (L)
  ./db/scripts/build.sh                            # db: pg_dump + docker build (bake)

注意:
  - 步骤语义:vocab 硬卡,sentences / audio 缺 env 也硬卡(不是 warn 跳过)。
    缺 AI_*/TENCENT_* 时 run.sh 退出 1,提示跑 eval-cms。
  - 只跑 vocab(不需要密钥)用: ./cms/scripts/cmd_vocab.sh
  - run.sh 入口一个硬卡闸门:Python deps 缺一就 fail (openai + PyYAML)。
    fetch_secrets.sh check 已经在 bootstrap 里做过,run.sh 不再重 check。
  - 此脚本只在 CMS host 跑 (需要 GH Environment 密钥,通过 fetch_secrets.sh eval-cms)
  - 此脚本不做 L 也不 bake — import_staging + build 各自独立跑
  - 此脚本不需要 POSTGRES_PASSWORD —— CMS 模块不连 db
EOF
}

case "${1:-}" in
    ""|run)         cmd_run ;;
    -h|--help|help) usage ;;
    *)              err "未知命令: $1"; usage; exit 1 ;;
esac
