#!/usr/bin/env bash
#
# monitor/dev.sh -- one-command dev mode.
#
# Starts the Python server (:9090) and Vite dev server (:5173) together.
# Both are killed on Ctrl+C. Logs go to .local/monitor/logs/{server,vite}.log
# AND are tailed to stdout with [server] / [vite] prefixes so you see
# both streams in one terminal.
#
# Usage:
#   bash monitor/dev.sh
#
# What it does:
#   1. (one-time) npm install if web/node_modules is missing
#   2. Start python3 monitor/server/server.py in background
#   3. Start Vite dev (with /api/* proxy to :9090) in background
#   4. Tail both logs to stdout (prefixed)
#   5. Wait for Ctrl+C; kill both; exit
#
# Access the dashboard at http://localhost:5173
# Direct API access at http://127.0.0.1:9090/s/api/v1/monitor/...

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# PROJECT_DIR: prefer caller-supplied shell env, else derive from SCRIPT_DIR.
# Note: `cd "$SCRIPT_DIR/.."` would also work, but we use the same explicit
# two-step form as dev-tools/native.sh for consistency / MSYS safety.
if [ -z "${PROJECT_DIR:-}" ]; then
    PROJECT_DIR="$(cd "$SCRIPT_DIR" && cd .. && pwd)"
fi
WEB_DIR="$SCRIPT_DIR/web"
LOG_DIR="$PROJECT_DIR/.local/monitor/logs"
PID_DIR="$PROJECT_DIR/.local/monitor/pids"
SERVER_PID_FILE="$PID_DIR/server.pid"

# Shared helpers: TTY colors, port probes, vite-port parser. See the
# header comment in _common.sh for the rationale (kept local to avoid
# ops/lib.sh's PROJECT_DIR cd side effect and Docker helper baggage).
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

# Server port. server.py reads TAL_MONITOR_PORT (default 9090); surface
# it here so pre-flight checks the right port (and the spawn section
# exports it for server.py).
SERVER_PORT="${TAL_MONITOR_PORT:-9090}"
export TAL_MONITOR_PORT="$SERVER_PORT"

# Install web deps if missing (idempotent). set -e would otherwise exit
# silently on a network/npm error — surface the failure with context.
if [ ! -d "$WEB_DIR/node_modules" ]; then
    echo "[dev] web/node_modules missing, running npm install..."
    if ! (cd "$WEB_DIR" && npm install); then
        err "[dev] web deps install failed (npm install exit non-zero)"
        err "[dev] fix: cd $WEB_DIR && npm install   (check network / npm registry)"
        exit 1
    fi
fi

# Pre-flight: idempotency + port collision.
#
# If a previous dev.sh is still alive (server.py wrote our PID file,
# kill -0 passes, AND the recorded PID owns the server port AND Vite is
# listening on :5173), this script is a re-run — skip spawn, attach to
# the existing log streams, exit 0 with a "already running" banner.
#
# If the port is occupied by a DIFFERENT PID (operator hand, leftover
# zombie, another tool) → hard-exit with a taskkill hint. No silent
# fallback: Vite's auto-shift to :5174+ would print a wrong dashboard URL
# and the operator would conclude the script is broken.
mkdir -p "$PID_DIR"

# Read + validate any previous-run PID file. server.py writes the
# *real* listener PID at startup (bash's $! is just the fork shell PID,
# not the python process). Vite's listener PID is recovered at attach
# time via netstat.
PREV_PYPID=""
[ -f "$SERVER_PID_FILE" ] && PREV_PYPID="$(cat "$SERVER_PID_FILE" 2>/dev/null || true)"

# If our recorded server PID is dead (or the file is empty), it's stale —
# clean up. We'll re-record fresh PIDs in the spawn section below.
if [ -n "$PREV_PYPID" ] && ! pid_alive "$PREV_PYPID"; then
    echo "[dev] stale pid file: $SERVER_PID_FILE (pid=$PREV_PYPID dead) — removing"
    rm -f "$SERVER_PID_FILE"
    PREV_PYPID=""
fi

# Attach path: server PID alive AND owns its port AND Vite listens on
# :5173. Vite's true listener PID is whatever netstat says — we don't
# store it (Vite spawn chain is too deep for $! to be reliable).
if [ -n "$PREV_PYPID" ] \
   && pid_listens_on "$PREV_PYPID" "$SERVER_PORT"; then
    VITE_PORT="5173"  # attach path: trust the recorded PIDs' port
    echo "[dev] already running — attaching to existing instance"
    echo "[dev]   python:  pid=$PREV_PYPID  (http://127.0.0.1:$SERVER_PORT)"
    if port_in_use_monitor 5173; then
        VITE_LISTEN_PID="$(port_pid_on 5173)"
        echo "[dev]   vite:    pid=${VITE_LISTEN_PID:-?}  (http://127.0.0.1:$VITE_PORT)"
    fi
    echo "[dev]   dashboard: http://localhost:$VITE_PORT"
    echo "[dev]   tailing logs (Ctrl+C to detach without killing)"
    echo
    trap 'echo; echo "[dev] detached (servers still running)"; exit 0' INT TERM
    ( tail -F "$LOG_DIR/server.log" 2>/dev/null | sed -u 's/^/[server] /' ) &
    ( tail -F "$LOG_DIR/vite.log"   2>/dev/null | sed -u 's/^/[vite]   /' ) &
    wait
    exit 0
fi

# Fresh-start path: any port collision against a NON-ours PID is fatal.
# Use the live netstat PID for the comparison (not the recorded one —
# at this point PREV_PYPID is either empty or the recorded server is
# confirmed alive but not listening on the port, so it doesn't qualify
# as "ours" anyway; the recorded server may legitimately be bound to
# another port if TAL_MONITOR_PORT was changed between runs).
for entry in "5173:Vite:dev" "${SERVER_PORT}:Python monitor server:dev"; do
    port="${entry%%:*}"
    rest="${entry#*:}"
    name="${rest%%:*}"
    if port_in_use_monitor "$port"; then
        pid="$(port_pid_on "$port")"
        # Allow our recorded server PID to "own" the port — but only if
        # it actually matches (defends against PID reuse).
        if [ -n "$pid" ] && [ -n "$PREV_PYPID" ] && [ "$pid" = "$PREV_PYPID" ]; then
            continue
        fi
        err "[dev] 端口 $port 已被占用 (pid=${pid:-?}, $name) — dev.sh 拒绝启动"
        if [ -n "$pid" ]; then
            err "[dev] 修: taskkill //PID $pid //F  (或停掉占 :$port 的进程)"
        else
            err "[dev] 修: netstat -ano | grep ':$port '  找到并停掉占用进程"
        fi
        exit 1
    fi
done

mkdir -p "$LOG_DIR"

# Start Python server in background. server.py writes its own PID to
# $SERVER_PID_FILE when TAL_PID_FILE is set — bash's $! here is the
# fork-shell PID, not the listener PID, so we don't trust it.
TAL_PID_FILE="$SERVER_PID_FILE" python3 "$SCRIPT_DIR/server/server.py" > "$LOG_DIR/server.log" 2>&1 &
PYPID_FORK=$!

# Start Vite dev server in background. Vite's spawn chain (subshell →
# npm → node → vite) means $! is unreliable too — we don't store it.
(cd "$WEB_DIR" && npm run dev) > "$LOG_DIR/vite.log" 2>&1 &
VITEPID_FORK=$!

# Wait briefly for server.py to write its real PID. Bound 5s — server.py
# writes the file before any request handling, so this is fast on a
# healthy box. If we time out, fall through and let the banner print the
# fork-shell PID (better than nothing).
for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -f "$SERVER_PID_FILE" ] && break
    sleep 0.5
done
PYPID="$(cat "$SERVER_PID_FILE" 2>/dev/null || echo "$PYPID_FORK")"

# Vite prints its actual bind port only in the log. Poll it (10s bound)
# so the banner below shows the real dashboard URL even on the rare race
# where something grabbed :5173 between our pre-flight and vite's bind.
VITE_PORT="$(check_vite_port "$LOG_DIR/vite.log" 10 || true)"
[ -z "$VITE_PORT" ] && VITE_PORT="5173"
VITEPID="$VITE_PORT"  # cosmetic — Vite's true listener PID is in the log; this just keeps the trap happy

# Cleanup on Ctrl+C or normal exit (idempotent: kill is no-op on dead PIDs)
cleanup() {
    echo
    echo "[dev] shutting down (python=$PYPID vite=$VITEPID)..."
    # Only kill if PYPID/VITEPID are set — pre-flight failure paths exit
    # without spawning, and in those paths PYPID/VITEPID are unset. We
    # must NOT touch a PID file that might belong to a previous-run
    # instance we're not actually responsible for.
    [ -n "${PYPID:-}" ] && kill "$PYPID" 2>/dev/null || true
    [ -n "${VITEPID:-}" ] && kill "$VITEPID" 2>/dev/null || true
    # Give children a moment to die gracefully, then force-kill stragglers.
    sleep 1
    [ -n "${PYPID:-}" ] && kill -9 "$PYPID" 2>/dev/null || true
    [ -n "${VITEPID:-}" ] && kill -9 "$VITEPID" 2>/dev/null || true
    wait 2>/dev/null || true
    # NOTE: server.py unlinks its own PID file in `finally` on shutdown,
    # and the Vite PID file is owned by the npm subshell (we don't even
    # store one). Don't rm them here — pre-flight failures could run this
    # trap and we'd delete someone else's PID file.
    echo "[dev] done"
}
trap cleanup EXIT INT TERM

echo "[dev] python server  pid=$PYPID  (http://127.0.0.1:$SERVER_PORT)"
echo "[dev] vite dev       pid=$VITEPID  (http://127.0.0.1:$VITE_PORT)"
echo "[dev] dashboard:     http://localhost:$VITE_PORT"
echo "[dev] api root:      http://127.0.0.1:$SERVER_PORT/s/api/v1/monitor/snapshot"
echo "[dev] logs:          $LOG_DIR/{server,vite}.log"
echo "[dev] Ctrl+C to stop both"
echo

# Tail both logs to stdout, each prefixed with its source.
# tail -F (capital F) follows by name (survives log rotation/recreation).
# sed -u = unbuffered so prefixes appear immediately, not after a newline.
( tail -F "$LOG_DIR/server.log" 2>/dev/null | sed -u 's/^/[server] /' ) &
( tail -F "$LOG_DIR/vite.log"   2>/dev/null | sed -u 's/^/[vite]   /' ) &

# Block until any child exits (Ctrl+C → trap fires → cleanup → script exits).
wait
