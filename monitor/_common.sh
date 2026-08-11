#!/usr/bin/env bash
#
# monitor/_common.sh — shared helpers for the monitor dev scripts.
#
# Sourced by monitor/dev.sh (and any future monitor/*.sh). Provides:
#   - TTY-only ANSI color guards (yellow / red / reset)
#   - port_in_use_monitor <port>     — returns 0/1, no print
#   - port_pid_on <port>               — echoes PID on the port, or ""
#   - check_vite_port <log> <timeout>  — parses "Local: ... :PORT/" from
#                                        a vite log, stripping ANSI
#
# Conventions:
#   - All helpers are POSIX `[ ]` (no `[[ ]]`); safe under set -e.
#   - Helpers that can fail at the probe layer (port_in_use_monitor,
#     check_vite_port) always return 0/1 cleanly so callers can `if` on
#     them without trapping set -e.
#   - `err` here uses red `[ERR]` prefix; matches ops/lib.sh style.
#
# Why a local _common.sh instead of sourcing ops/lib.sh:
#   - ops/lib.sh forces `cd "$PROJECT_DIR"` at source time, which would
#     change the operator's cwd when this script exits.
#   - ops/lib.sh pulls in Docker / image-tag / registry helpers monitor
#     does not need.

set -u  # no -e here — helpers are meant to be probed, not to fail loud

# ─── TTY-only ANSI colors ─────────────────────────────────────────────────
if [ -t 1 ]; then
    _Y='\033[1;33m'
    _R='\033[0;31m'
    _N='\033[0m'
else
    _Y=''; _R=''; _N=''
fi

err()  { printf '%s[ERR]%s  %s\n' "$_R" "$_N" "$1" >&2; }
warn() { printf '%s[WARN]%s %s\n' "$_Y" "$_N" "$1" >&2; }

# ─── port_in_use_monitor <port> ────────────────────────────────────────
# Returns 0 if a process is listening on <port>, 1 otherwise.
# Tries netstat -ano (Windows Git Bash, macOS), then ss -ltn (Linux).
# If neither tool exists, returns 1 (treat as "not in use" — caller may
# proceed and discover the truth at bind time).
port_in_use_monitor() {
    local port="$1"
    if command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null \
            | grep -E "[:.]${port}[[:space:]]" \
            | grep -qi LISTENING \
            && return 0
        return 1
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | grep -qE ":${port}\b" && return 0
        return 1
    fi
    return 1
}

# ─── port_pid_on <port> ──────────────────────────────────────────────────
# Echoes the PID listening on <port>, or "" if unknown / no listener.
# Best-effort: never errors. Used to name a zombie process in the error
# message ("...已被占用 (pid=1234)...").
port_pid_on() {
    local port="$1"
    if command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null \
            | grep -E "[:.]${port}[[:space:]]" \
            | grep -i LISTENING \
            | awk '{print $NF}' \
            | grep -E '^[0-9]+$' \
            | head -1
        return 0
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -ltnp 2>/dev/null \
            | grep -E ":${port}\b" \
            | grep -oE 'pid=[0-9]+' \
            | head -1 \
            | cut -d= -f2
        return 0
    fi
    echo ""
}

# ─── pid_alive <pid> ─────────────────────────────────────────────────────
# Returns 0 if <pid> is a running process, 1 otherwise.
# Empty/non-numeric pid → 1. Used to detect stale PID files left by a
# dev.sh that died without cleanup.
#
# Windows note: Git Bash uses its own PID namespace; bash's built-in
# `kill -0 <pid>` only sees MSYS processes, not native Windows ones
# (Python, Vite, etc.). Fall back to `tasklist //FI "PID eq <pid>"` on
# Windows, which queries the real OS process table. On Linux/macOS,
# `kill -0` works as expected.
pid_alive() {
    local pid="$1"
    if [ -z "$pid" ] || ! [ "$pid" -gt 0 ] 2>/dev/null; then
        return 1
    fi
    if command -v tasklist >/dev/null 2>&1; then
        # Windows: native process lookup. `tasklist` exits 0 if the PID
        # is found, 1 if not. The `//FI` filter is MSYS-path-safe.
        tasklist //FI "PID eq $pid" 2>/dev/null | grep -qE "[[:space:]]${pid}[[:space:]]"
        return $?
    fi
    kill -0 "$pid" 2>/dev/null && return 0
    return 1
}

# ─── pid_listens_on <pid> <port> ────────────────────────────────────────
# Returns 0 if <pid> is currently LISTENING on <port>, 1 otherwise.
# Used to confirm a recorded PID file actually owns the port — defends
# against PID reuse (different process recycled our old PID).
pid_listens_on() {
    local pid="$1" port="$2"
    [ -z "$pid" ] && return 1
    if command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null \
            | grep -E "[:.]${port}[[:space:]]" \
            | grep -i LISTENING \
            | awk -v p="$pid" '$NF == p' \
            | grep -q . \
            && return 0
        return 1
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -ltnp 2>/dev/null \
            | grep -E ":${port}\b" \
            | grep -qE "pid=${pid}\b"
        return $?
    fi
    return 1
}

# ─── check_vite_port <log_path> <timeout_s> ──────────────────────────────
# Busy-polls <log_path> for vite's "Local: http://localhost:PORT/" line
# (strips ANSI first — Vite colors the port and the "Local:" label).
# Echoes PORT, or "" on timeout.
#
# Use right after spawning vite: this is a synchronous wait, not a
# background tailer. Timeout default in callers is 10s — vite's "ready"
# line lands within ~3s on a healthy box.
check_vite_port() {
    local log="$1" timeout_s="$2"
    local end=$(( $(date +%s) + timeout_s ))
    while [ "$(date +%s)" -lt "$end" ]; do
        local hit
        hit="$(sed -e $'s/\x1b\\[[0-9;]*[a-zA-Z]//g' "$log" 2>/dev/null \
            | grep -oE 'Local:[[:space:]]*http://localhost:[0-9]+/' \
            | head -1 || true)"
        if [ -n "$hit" ]; then
            echo "$hit" | grep -oE '[0-9]+' | head -1
            return 0
        fi
        sleep 0.2
    done
    echo ""
    return 1
}