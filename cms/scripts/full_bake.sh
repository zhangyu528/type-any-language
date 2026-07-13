#!/usr/bin/env bash
#
# cms/scripts/full_bake.sh — orchestrate the full CMS content-production
# pipeline end-to-end. Lives here (not in dev-host/run.sh) because every
# step is a CMS-side concern — vocab CSVs, AI/TTS calls, db image bake.
#
# What it does (in order):
#   (a) ensure a postgres source is reachable (container / local / fresh run)
#   (b) apply schema migrations + create_all safety net
#   (c) import vocab CSVs → vocabulary_libs / vocabulary_words
#   (d) AI-fill sentences (best-effort — skipped if AI_* unset, warn-on-fail)
#   (e) TTS-fill audio       (best-effort — skipped if TENCENT_* unset, warn-on-fail)
#   (f) bake the db image (dump.sql + audio/ → docker build)
#
# Used by:
#   • scripts/dev-host/lifecycle.sh::cmd_setup — single-host CMS+dev auto-bake
#   • CMS host operator — `./cms/scripts/full_bake.sh` standalone after
#     editing CSVs / manifest / prompt, to rebuild the db image locally
#
# Hard-fail on (a) / (b) / (c) / (f) — those should only fail if the env is
# broken (no docker, no cms/.env, schema migration crash). Best-effort on
# (d) / (e) — those depend on external services (OpenAI / Tencent TTS) that
# rate-limit or run out of quota. If they fail, log loud warnings and let
# the bake proceed with whatever content sync produced. The runtime will
# still come up; /api/sentences just returns [] / /api/audio/<hash>.mp3 404s
# until the next full_bake run fills them in.
#
# Exit codes:
#   0   all steps reached the bake (sentences / audio may have warned)
#   1   hard failure on (a) / (b) / (c) / (f), OR cms/.env missing / doctor fail

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

# ensure_source_db — make sure a postgres source for the bake is reachable.
# Tries three strategies, in order:
#   1. english_db / english_db_dev container already running — use it.
#   2. local postgres reachable at POSTGRES_HOST:POSTGRES_PORT — use it.
#   3. spin up a fresh english_db container (postgres:15-alpine) with the
#      right POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD, published on
#      $POSTGRES_PORT (default 5432) so content.sh on the host can reach it.
# Returns 0 if a source db is reachable after the call; 1 otherwise.
ensure_source_db() {
    # 1. named container already running?
    local running
    running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^(english_db|english_db_dev)$' | head -1 || true)"
    if [ -n "$running" ]; then
        ok "  source db: container '$running' 已在跑"
        return 0
    fi

    local pg_user="${POSTGRES_USER:-english_user}"
    local pg_db="${POSTGRES_DB:-english_learning}"
    local pg_host="${POSTGRES_HOST:-localhost}"
    local pg_port="${POSTGRES_PORT:-5432}"

    # 2. local postgres reachable at POSTGRES_HOST:POSTGRES_PORT?
    #    Skip silently if host has no psql — fall through to docker run.
    if command -v psql &>/dev/null && \
       PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$pg_host" -p "$pg_port" \
            -U "$pg_user" -d "$pg_db" -tAc "SELECT 1" &>/dev/null; then
        ok "  source db: 本地 postgres ($pg_host:$pg_port) 可达"
        return 0
    fi

    # 3. spin up a fresh english_db container. Re-use a stopped one if present
    #    (typical after a `docker stop` between sessions — keeps the data vol).
    info "  source db: 本地无可达 postgres — 自动起 english_db 容器..."
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qE '^english_db$'; then
        info "    english_db 容器存在但未跑 — 启动"
        if ! docker start english_db >/dev/null; then
            err "    docker start english_db 失败"
            return 1
        fi
    else
        info "    创建 english_db (postgres:15-alpine)..."
        if ! docker run -d \
                --name english_db \
                -e "POSTGRES_USER=$pg_user" \
                -e "POSTGRES_DB=$pg_db" \
                -e "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
                -p "${pg_port}:5432" \
                -v cms-source-data:/var/lib/postgresql/data \
                postgres:15-alpine >/dev/null; then
            err "    docker run english_db 失败 — 检查 docker / 端口冲突 (${pg_host}:${pg_port})"
            return 1
        fi
    fi

    # Wait up to 30s for the container to accept connections. Use docker exec
    # so this works even on hosts without psql (Windows / macOS without
    # postgres-client installed) — pg_isready is bundled inside the image.
    info "    等 english_db 就绪 (最多 30s)..."
    local i
    for i in $(seq 1 30); do
        if docker exec english_db pg_isready -U "$pg_user" -d "$pg_db" &>/dev/null; then
            ok "  source db: english_db 就绪"
            return 0
        fi
        sleep 1
    done
    err "    english_db 30s 内未就绪 — 看 docker logs english_db 找原因"
    return 1
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

    # (b) schema (idempotent — CREATE TABLE IF NOT EXISTS).
    run_content_step "init-schema" init-schema || return 1

    # (c) vocab CSVs → DB (idempotent — skip-existing per commit 0a14705).
    run_content_step "sync (CSVs → vocab)" sync || return 1

    # (d) AI-fill sentences. Best-effort: AI_* missing → skip; API fails →
    # warn and continue (runtime still comes up, /api/sentences returns []).
    if [ -n "${AI_API_KEY:-}" ] && [ -n "${AI_BASE_URL:-}" ] && [ -n "${AI_MODEL:-}" ]; then
        run_content_step "sentences (AI-fill)" sentences || \
            warn "  sentences 失败 — 跳过 (runtime 起来后 /api/sentences 会返回空)"
    else
        warn "  跳过 sentences (AI_API_KEY / AI_BASE_URL / AI_MODEL 没设齐)"
    fi

    # (e) TTS audio. All-or-nothing: any TENCENT_* missing → skip.
    if [ -n "${TENCENT_SECRET_ID:-}" ] && [ -n "${TENCENT_SECRET_KEY:-}" ] && \
       [ -n "${TENCENT_APP_ID:-}" ]; then
        run_content_step "audio (TTS-fill)" audio || \
            warn "  audio 失败 — 跳过 (sentences.audio_url 没填 /audio/<hash>.mp3 会 404)"
    else
        warn "  跳过 audio (TENCENT_* 没填齐)"
    fi

    # (f) bake.
    info "  (f) db/scripts/build.sh"
    if ! "$PROJECT_DIR/db/scripts/build.sh"; then
        err "  db/scripts/build.sh 失败 — 看上面 export_bundle 的错误"
        return 1
    fi
    ok "  db/scripts/build.sh ok"
    return 0
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (无参数) | run    跑完整 CMS 6 步 pipeline (ensure-db → init-schema → sync → sentences → audio → bake)
  doctor            prefight: cms/.env + POSTGRES_PASSWORD + content.sh doctor + docker
  -h|--help|help    显示本帮助

典型工作流:
  # 首次 / 改 CSV 后 / 改 prompt 后:
  ./cms/scripts/full_bake.sh                # 跑完整流程
  ./cms/scripts/full_bake.sh doctor        # 排查前先跑这个

调它的脚本:
  scripts/dev-host/lifecycle.sh::cmd_setup    # 单机 CMS+dev setup 时自动调用

注意:
  - sentences / audio 是 best-effort:外部 API 失败会 warn 但继续,bake 仍跑
  - schema / sync / bake 任何一步失败 → 整个脚本 fail (硬错)
  - 此脚本只在 CMS host 跑 (需要 cms/.env + POSTGRES_PASSWORD)
EOF
}

case "${1:-}" in
    ""|run)     cmd_run ;;
    doctor)     cmd_doctor ;;
    -h|--help|help)  usage ;;
    *)          err "未知命令: $1"; usage; exit 1 ;;
esac