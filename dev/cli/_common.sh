#!/bin/bash
#
# dev/cli/_common.sh — shared helpers for the dev scripts.
#
# Sourced by every script in dev/cli/. Provides db-lifecycle helpers
# (start the docker db, check it's healthy, warn if it's empty) and a
# staging-files inventory check. No image / registry / watch machinery
# — the dev loop is host-native (dev/cli/native.sh), the only docker
# artifact on a dev host is the `db` service in docker-compose.dev.yml.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - `detect_compose_cmd` must be called before any helper that uses
#     $DOCKER_COMPOSE_CMD (require_dev_db_up, ensure_dev_db_up, dev_db_is_up).
#     Most callers run it at the top of the script; native.sh does it
#     explicitly because it doesn't go through the host env that other
#     dev scripts set up.
#
# Runtime model:
#   db         — postgres:15-alpine, data bind-mounted to .docker-postgres-data/
#   backend    — runs on the host (uvicorn --reload, see dev/cli/run.sh)
#   frontend   — runs on the host (next dev, see dev/cli/run.sh)
#
# DATABASE_URL on the host is `postgresql://english_dev:devpw@localhost:5432/english_dev`
# (the same credentials as the db service exposes on the host's :5432).
# No compose `environment:` block for the app — they're host processes.

set -e

# Repo root is two levels above dev/cli/ (COMMON_DIR). Use two explicit
# `cd ..` segments (matching native.sh) — a single `cd "$COMMON_DIR/../.."`
# collapses to the wrong parent on MSYS/Git Bash.
: "${PROJECT_DIR:=$(cd "$COMMON_DIR" && cd .. && cd .. && pwd)}"
cd "$PROJECT_DIR"

# ─── Self-contained helpers (no ops/ dependency) ──────────────────────────
# devcli is host-native; the only ops/lib.sh symbols it ever consumed
# were these lightweight logging + compose-detection helpers, so we inline
# them here instead of source-ing ops/lib.sh (which is about image tags /
# registry / prod secrets — none of which a dev host needs).
if [ -t 1 ]; then
    _LIB_RED='\033[0;31m'; _LIB_GREEN='\033[0;32m'
    _LIB_YELLOW='\033[1;33m'; _LIB_BLUE='\033[1;34m'; _LIB_NC='\033[0m'
else
    _LIB_RED=''; _LIB_GREEN=''; _LIB_YELLOW=''; _LIB_BLUE=''; _LIB_NC=''
fi
ok()   { echo -e "${_LIB_GREEN}[OK]${_LIB_NC}   $1"; }
warn() { echo -e "${_LIB_YELLOW}[WARN]${_LIB_NC} $1"; }
info() { echo -e "${_LIB_BLUE}[INFO]${_LIB_NC} $1"; }
err()  { echo -e "${_LIB_RED}[ERR]${_LIB_NC}  $1"; }

detect_compose_cmd() {
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        return 1
    fi
}

# ─── Missing helpers (refactor left these behind) ──────────────────────────
# These used to come transitively from ops/lib.sh (via the old
# `source ops/lib.sh` in _common.sh). They're host-native, lightweight, and
# have nothing to do with image tags / registry / prod secrets, so we inline
# them here for real — devcli no longer touches ops/.
#
# `docker info` can hang for ~30s when the daemon is not running (Docker
# Desktop is launching). Bound the wait so preflight doesn't appear frozen.
check_docker_daemon_running() {
    timeout 5 docker info &> /dev/null
}

check_docker_installed() {
    command -v docker &> /dev/null
}

# port_in_use <port> → returns 0 if the port is listening, 1 otherwise.
# Uses `ss` if available, falls back to `netstat`, then a /proc scan.
port_in_use() {
    local port="$1"
    if command -v ss &> /dev/null; then
        ss -tln 2>/dev/null | grep -qE ":${port}\b" && return 0
    fi
    if command -v netstat &> /dev/null; then
        netstat -tln 2>/dev/null | grep -qE ":${port}\b" && return 0
    fi
    # Last-resort: TCP table on Linux.
    if [ -r /proc/net/tcp ]; then
        awk -v p="$port" 'BEGIN{p=strtonum("0x"p)} $2 ~ ":"p"$" {found=1; exit} END{exit !found}' /proc/net/tcp 2>/dev/null
        return $?
    fi
    return 1
}

# warn_port_in_use <port> <description> → prints warning if occupied.
# Always returns 0: warnings are advisory, never fail the script under `set -e`.
warn_port_in_use() {
    local port="$1"
    local desc="$2"
    if port_in_use "$port"; then
        warn "$desc (端口 $port) 已被占用"
    fi
    return 0
}

# setup_dev_host_env: populates $DOCKER_COMPOSE_CMD for host-side scripts
# (migrate.sh / logs.sh / import_content.sh). Idempotent — safe to call
# multiple times. We deliberately do NOT resolve image tags / registry
# here; dev is host-native, no images are pulled.
setup_dev_host_env() {
    if ! detect_compose_cmd; then
        err "未找到 docker-compose / docker compose"
        return 1
    fi
    export DOCKER_COMPOSE_CMD
}

# _backend_python — echo the Python interpreter used to run the backend.
#
# Preference order:
#   1. backend/.venv (the canonical backend runtime, created by
#      `bash dev setup`) — works even when no global Python is on PATH.
#   2. a global python3 / python on PATH (hosts that install Python globally).
#
# Echoes an empty string only if no Python can be found at all. Every
# devcli script that shells out to the backend uses this instead of a
# bare `python3`, so `bash dev/dev run|migrate|doctor` keep working on hosts
# whose PATH only has the project venv (Windows Store "python" alias,
# missing global install, etc.).
_backend_python() {
    local venv_win="$PROJECT_DIR/backend/.venv/Scripts/python.exe"
    local venv_nix="$PROJECT_DIR/backend/.venv/bin/python"
    if [ -x "$venv_win" ]; then
        echo "$venv_win"
    elif [ -x "$venv_nix" ]; then
        echo "$venv_nix"
    elif command -v python3 >/dev/null 2>&1; then
        echo "python3"
    elif command -v python >/dev/null 2>&1; then
        echo "python"
    else
        echo ""
    fi
}

# ─── Globals ───────────────────────────────────────────────────────────────
COMPOSE_FILE="$PROJECT_DIR/dev/cli/docker-compose.dev.yml"

# ─── require_dev_db_up ────────────────────────────────────────────────────
# For host-side scripts that talk to the dev docker postgres directly
# (migrate.sh). Verifies the db container is running AND its healthcheck
# reports healthy. Prints a clear hint pointing at native.sh start
# if the db isn't up; otherwise the host script just fails with a
# confusing psycopg "connection refused" / "database does not exist"
# error.
require_dev_db_up() {
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "dev db 容器没起 — host-side migrate 无 db 可连"
        info "  → 运行: bash dev/dev run"
        return 1
    fi
    status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
    if [ "$status" != "healthy" ]; then
        err "dev db 容器状态: ${status:-unknown} (need healthy)"
        info "  → 等几秒再试,或: docker compose -f docker-compose.dev.yml restart db"
        return 1
    fi
    return 0
}

# ─── ensure_dev_db_up ────────────────────────────────────────────────────
# Self-healing variant of require_dev_db_up, used by import_content.sh.
# If the db container is missing, brings up ONLY the db service
# (no backend/frontend — the app stack runs on the host) and waits
# for its healthcheck to report healthy.
#
# Rationale: import is a content operation the operator may run before
# `native.sh start` (e.g. immediately after setup on a fresh
# checkout, or after pulling new cms/content/ from the CMS host).
# Forcing them to also start backend/frontend just to import would
# load the wrong "ready" semantics onto the import command.
ensure_dev_db_up() {
    if dev_db_is_up; then
        return 0
    fi
    info "dev db 容器没起 — 自动起 db 服务..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never --no-deps db
    # Wait up to 30s for healthcheck.
    local cid i status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "  db 服务没起来 — 看 docker compose logs db"
        return 1
    fi
    for i in 1 2 3 4 5 6 7 8 9 10; do
        python -c "import time; time.sleep(3)"
        status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
        if [ "$status" = "healthy" ]; then
            ok "  db 容器已 healthy"
            return 0
        fi
    done
    err "  db 容器 30s 内未 healthy (last status: ${status:-unknown})"
    info "  → 看日志: docker compose logs db"
    return 1
}

# ─── dev_db_is_up ─────────────────────────────────────────────────────────
# Silent boolean probe for "is the db container running and healthy?".
# Returns 0 (true) / 1 (false); no print. Shared by require_dev_db_up
# (which prints on failure) and ensure_dev_db_up (which heals on
# failure). Also used by native.sh start for the empty-db warning.
dev_db_is_up() {
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    [ -z "$cid" ] && return 1
    status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
    [ "$status" = "healthy" ] && return 0
    return 1
}

# ─── warn_if_db_empty ────────────────────────────────────────────────────
# After native.sh start brings up the db, check whether the db
# has any content (vocabulary_libs row count). 0 rows → warn + hint
# at import_content.sh. Skip silently if the db container isn't up
# (which would mean start itself failed — already surfaced elsewhere).
#
# psql is part of the postgres image but not in $PATH on the host; run
# it via `docker compose exec db` so the operator doesn't need to
# install psql locally.
warn_if_db_empty() {
    if ! dev_db_is_up; then
        return 0
    fi
    local count
    count="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" exec -T db \
        psql -U english_dev -d english_dev -tAc \
        "SELECT count(*) FROM vocabulary_libs;" 2>/dev/null | tr -d ' ' || echo "")"
    if [ -z "$count" ]; then
        # Query failed (e.g. table doesn't exist yet because migrations
        # haven't run). Don't false-positive the warning.
        return 0
    fi
    if [ "$count" = "0" ]; then
        warn "db 是空的 (vocabulary_libs = 0 行)"
        info "  → 灌入内容: bash dev/dev import"
        info "    (会自动起 db,如果没起;需要 cms/content/{vocabulary,sentences}/ 已有 staging 文件)"
    fi
}

# ─── require_staging_files ────────────────────────────────────────────────
# import_content.sh: refuse to run if cms/content/ has no staging files.
# Without this guard, calling import with an empty source dir causes the
# importer to UPSERT zero rows — which for vocab means wiping the table.
#
# On success, prints the file inventory so the operator can confirm
# "yes, these are the files I want imported" before db rows change.
require_staging_files() {
    local content_dir="$PROJECT_DIR/cms/content"
    local vocab_count sentence_count
    local vocab_files=() sentence_files=()
    while IFS= read -r f; do
        [ -n "$f" ] && vocab_files+=("$f")
    done < <(find "$content_dir/vocabulary" -maxdepth 1 -name '*.json' 2>/dev/null | sort)
    while IFS= read -r f; do
        [ -n "$f" ] && sentence_files+=("$f")
    done < <(find "$content_dir/sentences" -maxdepth 1 -name '*.jsonl' 2>/dev/null | sort)
    vocab_count=${#vocab_files[@]}
    sentence_count=${#sentence_files[@]}
    if [ "$vocab_count" -eq 0 ] && [ "$sentence_count" -eq 0 ]; then
        err "cms/content/ 下没有 staging 文件"
        info "  → 先跑: ./cms/run.sh        # 产出 cms/content/{vocabulary,sentences}/"
        info "  → 或:    ./cms/scripts/cmd_vocab.sh + cmd_sentences.sh (拆开跑)"
        return 1
    fi
    info "  staging 文件: vocabulary=$vocab_count, sentences=$sentence_count"
    if [ "$vocab_count" -gt 0 ]; then
        info "  vocabulary:"
        for f in "${vocab_files[@]}"; do
            info "    $(basename "$f")"
        done
    fi
    if [ "$sentence_count" -gt 0 ]; then
        info "  sentences:"
        for f in "${sentence_files[@]}"; do
            info "    $(basename "$f")"
        done
    fi
    return 0
}
