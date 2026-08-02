#!/usr/bin/env bash
#
# ops/dev/restart_backend.sh — backend-only restart that ACTUALLY frees :8000.
#
# Why this exists alongside ops/dev/native.sh restart:
#
#   uvicorn --reload on Windows spawns three processes:
#     - the master (PID we put in .native-pids/backend.pid)
#     - the worker (the one actually serving HTTP)
#     - the WatchFiles watcher (reloads on file change)
#
#   `native.sh restart` only sends SIGTERM to the master PID in the
#   pid file. On Windows, master SIGTERM does not always cascade —
#   the WatchFiles watcher can detach into the orphaned-by-design
#   category, and the kernel keeps its :8000 LISTEN socket alive
#   even after the python.exe process is gone (visible to netstat
#   / Get-NetTCPConnection, invisible to tasklist / Get-Process /
#   Stop-Process). Subsequent `uvicorn --reload` then fails with
#   WinError 10048 ("address in use") even though there's nothing
#   to kill.
#
#   This script is the Windows-specific workaround:
#     1. kill the pid file PID (graceful SIGTERM, then SIGKILL)
#     2. ALSO scan :8000 for any leftover LISTEN-owning PID via
#        netstat + taskkill /F (best-effort — orphans whose
#        python.exe is already gone won't be reachable, but the
#        sweep usually catches the WatchFiles watcher)
#     3. wait 2s for the kernel to recycle TIME_WAIT / orphan
#        sockets; in practice this is enough
#     4. spawn a fresh uvicorn --reload, no /F fallback (port is
#        presumed released by step 3)
#
#   If step 4 STILL fails with WinError 10048, the kernel is
#   holding a truly-orphaned socket (rare — happens after several
#   crash-restart cycles in quick succession). The script prints
#   a clear hint about `netsh winsock reset` (which disconnects
#   the network and requires a reboot) or rebooting the box.
#
# Subcommands:
#   (default)   restart backend in place
#   stop        only do the kill + sweep; do not start
#
# Env knobs (inherited from native.sh conventions):
#   BACKEND_PORT    default 8000
#   DATABASE_URL    default english_dev on localhost:5432
#   ALLOWED_ORIGINS default localhost dev set

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_DIR="$BACKEND_DIR/.venv"
PID_DIR="$PROJECT_ROOT/.native-pids"
LOG_DIR="$PROJECT_ROOT/.native-logs"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"

DEFAULT_ALLOWED_ORIGINS="http://localhost,http://localhost:3000,http://localhost:54102,http://localhost:55407,http://localhost:55500"
DEFAULT_DATABASE_URL="postgresql://english_dev:devpw@localhost:5432/english_dev"

# Minimal info/ok/err — kept local so we don't need _common.sh.
info() { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[OK]   %s\n' "$*"; }
err()  { printf '[ERR]  %s\n' "$*" >&2; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

usage() {
    cat <<EOF
Usage: $0 [stop]

  (default)  kill any pidfile + :$BACKEND_PORT LISTENers, then start a fresh
             uvicorn --reload
  stop       only do the kill + sweep, do not start

Env: BACKEND_PORT (default $BACKEND_PORT), DATABASE_URL, ALLOWED_ORIGINS.
EOF
}

cmd="${1:-restart}"
case "$cmd" in
    stop)        only_stop=1 ;;
    restart|"")  only_stop=0 ;;
    -h|--help|help) usage; exit 0 ;;
    *) err "unknown subcommand: $cmd"; usage; exit 2 ;;
esac

_alive() {
    local pid_file="$1"
    [ -f "$pid_file" ] || return 1
    local pid; pid="$(cat "$pid_file" 2>/dev/null || echo "")"
    [ -n "$pid" ] || return 1
    matches="$(tasklist //NH 2>/dev/null | grep -E "(^|[[:space:]])${pid}([[:space:]]|$)" || true)"
    [ -n "$matches" ] && return 0
    kill -0 "$pid" 2>/dev/null
}

_kill_pidfile() {
    if _alive "$BACKEND_PID_FILE"; then
        local pid; pid="$(cat "$BACKEND_PID_FILE")"
        info "停 backend master (PID $pid) via pid file"
        kill "$pid" 2>/dev/null || true
        local i
        for i in 1 2 3 4 5 6 7 8 9 10; do
            _alive "$BACKEND_PID_FILE" || break
            sleep 0.3
        done
        if _alive "$BACKEND_PID_FILE"; then
            warn "master 不响应 SIGTERM, taskkill /F"
            taskkill //PID "$pid" //F 2>/dev/null || true
        fi
        rm -f "$BACKEND_PID_FILE"
        return 0
    fi
    [ -f "$BACKEND_PID_FILE" ] && rm -f "$BACKEND_PID_FILE"
    return 1
}

# Windows-specific sweep: any process holding :$BACKEND_PORT in
# LISTEN, even if it's the reload-orphan watcher that escaped our
# pid file. Best-effort — silent when nothing is found.
_sweep_port() {
    local port="$1"
    local pids
    pids="$(netstat -ano 2>/dev/null \
        | awk -v p=":$port " '$0 ~ p && $0 ~ "LISTENING" {print $NF}' \
        | sort -u)"
    [ -z "$pids" ] && { ok "no leftover LISTEN on :$port"; return 0; }
    local killed=0
    for pid in $pids; do
        [ "$pid" -gt 0 ] 2>/dev/null || continue
        info "sweeping :$port LISTENer (PID $pid)"
        taskkill //PID "$pid" //F 2>/dev/null && killed=$((killed+1)) \
            || warn "  taskkill PID $pid failed (process may be gone)"
    done
    [ "$killed" -gt 0 ] && ok "swept $killed LISTENer(s) on :$port"
}

# Same MSYS-safe spawn shape as native.sh::_start_one: bash -c wrapper
# with positional args so Git Bash doesn't rewrite leading-/ paths.
_spawn_backend() {
    local venv_activate
    if [ -f "$VENV_DIR/Scripts/activate" ]; then
        venv_activate="$VENV_DIR/Scripts/activate"
    else
        venv_activate="$VENV_DIR/bin/activate"
    fi
    (
        bash -c 'cd "$1" && source "$2" && exec uvicorn app.main:app --reload --host 0.0.0.0 --port "$3"' \
            _ "$BACKEND_DIR" "$venv_activate" "$BACKEND_PORT" \
            >>"$BACKEND_LOG" 2>&1 &
    )
    sleep 0.7
    # Resolve real Windows PID via WMI (MSYS `$!` is a bash subshell PID,
    # not the python.exe PID — same trap native.sh works around).
    local real_pid=""
    real_pid="$(powershell.exe -NoProfile -Command \
        "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { \$_.CommandLine -like '*uvicorn*' -and \$_.CommandLine -like '*app.main:app*' -and \$_.CommandLine -like '*--port*' } | Select-Object -First 1 -ExpandProperty ProcessId)" \
        2>/dev/null | tr -d '\r' || true)"
    if [ -z "$real_pid" ]; then
        warn "PID 解析失败 — 看 $BACKEND_LOG"
        return 1
    fi
    echo "$real_pid" > "$BACKEND_PID_FILE"
    ok "backend PID=$real_pid"
}

mkdir -p "$PID_DIR" "$LOG_DIR"

info "=== backend restart :$BACKEND_PORT ==="
_kill_pidfile || info "no pid file — first run or already stopped"
_sweep_port "$BACKEND_PORT"
# Brief pause so the kernel can recycle TIME_WAIT / orphan sockets.
sleep 2

if [ "${only_stop:-0}" -eq 1 ]; then
    ok "stopped (start skipped)"
    exit 0
fi

export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$DEFAULT_ALLOWED_ORIGINS}"
export DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"

: > "$BACKEND_LOG"
_spawn_backend

# Give uvicorn a moment to either bind or 10048. Probe pidfile + log.
sleep 2
if ! _alive "$BACKEND_PID_FILE"; then
    err "backend 没起来 — 检查 $BACKEND_LOG"
    if grep -q "10048" "$BACKEND_LOG" 2>/dev/null; then
        err "  ↳ WinError 10048: 内核还在占着 :$BACKEND_PORT (kernel leak)"
        err "  ↳ 兜底: 重启电脑,或 netsh winsock reset (会断网,需重启)"
    fi
    exit 1
fi

# Quick HTTP probe to confirm router registration
if curl -fsS -o /dev/null "http://localhost:$BACKEND_PORT/health"; then
    ok "backend 已在 :$BACKEND_PORT (PID $(cat "$BACKEND_PID_FILE"))"
else
    warn "backend 启动了但 /health 没响应 — 看 $BACKEND_LOG"
fi