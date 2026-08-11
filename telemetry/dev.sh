#!/usr/bin/env bash
#
# telemetry/dev.sh -- one-command dev mode.
#
# Starts the Python server (:9090) and Vite dev server (:5173) together.
# Both are killed on Ctrl+C. Logs go to telemetry/.dev-logs/{server,vite}.log
# AND are tailed to stdout with [server] / [vite] prefixes so you see
# both streams in one terminal.
#
# Usage:
#   bash telemetry/dev.sh
#
# What it does:
#   1. (one-time) npm install if web/node_modules is missing
#   2. Start python3 telemetry/server/server.py in background
#   3. Start Vite dev (with /api/* proxy to :9090) in background
#   4. Tail both logs to stdout (prefixed)
#   5. Wait for Ctrl+C; kill both; exit
#
# Access the dashboard at http://localhost:5173
# Direct API access at http://127.0.0.1:9090/api/v1/telemetry/...

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"
LOG_DIR="$SCRIPT_DIR/.dev-logs"

# Install web deps if missing (idempotent)
if [ ! -d "$WEB_DIR/node_modules" ]; then
    echo "[dev] web/node_modules missing, running npm install..."
    (cd "$WEB_DIR" && npm install)
fi

mkdir -p "$LOG_DIR"

# Start Python server in background
python3 "$SCRIPT_DIR/server/server.py" > "$LOG_DIR/server.log" 2>&1 &
PYPID=$!

# Start Vite dev server in background
(cd "$WEB_DIR" && npm run dev) > "$LOG_DIR/vite.log" 2>&1 &
VITEPID=$!

# Cleanup on Ctrl+C or normal exit (idempotent: kill is no-op on dead PIDs)
cleanup() {
    echo
    echo "[dev] shutting down (python=$PYPID vite=$VITEPID)..."
    kill "$PYPID" "$VITEPID" 2>/dev/null || true
    # Give children a moment to die gracefully, then force-kill stragglers.
    sleep 1
    kill -9 "$PYPID" "$VITEPID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "[dev] done"
}
trap cleanup EXIT INT TERM

echo "[dev] python server  pid=$PYPID  (http://127.0.0.1:9090)"
echo "[dev] vite dev       pid=$VITEPID  (http://127.0.0.1:5173)"
echo "[dev] dashboard:     http://localhost:5173"
echo "[dev] api root:      http://127.0.0.1:9090/api/v1/telemetry/snapshot"
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
