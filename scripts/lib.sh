#!/bin/bash
#
# lib.sh — shared helpers for the init / build / run scripts.
#
# Source this file from any script:
#     SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#     source "$SCRIPT_DIR/lib.sh"
#
# Provides:
#   - ok / warn / err / info      (colored printers)
#   - detect_compose_cmd         (sets DOCKER_COMPOSE_CMD global)
#   - check_docker_installed     (returns 0/1, no print)
#   - check_docker_daemon_running
#   - require_docker             (exit 1 on fail, with friendly error)
#   - file_exists                (returns 0/1)
#   - require_file               (exit 1 on fail)
#   - image_exists               (returns 0/1)
#   - require_image              (exit 1 on fail)
#   - port_in_use                (returns 0/1, no print)
#   - warn_port_in_use           (prints warning if in use)
#   - gen_secret                 (random URL-safe string)
#   - detect_default_registry    (docker.io/$USER or empty)
#

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    _LIB_RED='\033[0;31m'
    _LIB_GREEN='\033[0;32m'
    _LIB_YELLOW='\033[1;33m'
    _LIB_BLUE='\033[1;34m'
    _LIB_NC='\033[0m'
else
    _LIB_RED=''; _LIB_GREEN=''; _LIB_YELLOW=''; _LIB_BLUE=''; _LIB_NC=''
fi

ok()   { echo -e "${_LIB_GREEN}[OK]${_LIB_NC}   $1"; }
warn() { echo -e "${_LIB_YELLOW}[WARN]${_LIB_NC} $1"; }
info() { echo -e "${_LIB_BLUE}[INFO]${_LIB_NC} $1"; }
err()  { echo -e "${_LIB_RED}[ERR]${_LIB_NC}  $1"; }

# ---------------------------------------------------------------------------
# Docker / Compose detection
# ---------------------------------------------------------------------------
# detect_compose_cmd: populates $DOCKER_COMPOSE_CMD. Returns 0 on success, 1
# if neither docker-compose nor `docker compose` is available.
detect_compose_cmd() {
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        return 1
    fi
}

# Silent checks (return 0/1, no output).
check_docker_installed() {
    command -v docker &> /dev/null
}

# `docker info` can hang for ~30s when the daemon is not running (e.g. Docker
# Desktop is launching). Bound the wait so that doctor / start don't appear
# frozen. 5 seconds is plenty for a healthy daemon to respond.
check_docker_daemon_running() {
    if command -v timeout &> /dev/null; then
        timeout 5 docker info &> /dev/null
    else
        # Fallback: run in background, kill after timeout.
        docker info &> /dev/null &
        local pid=$!
        # shellcheck disable=SC2064
        (sleep 5 && kill -0 $pid 2>/dev/null && kill $pid 2>/dev/null) &
        local watchdog=$!
        wait $pid
        local rc=$?
        kill $watchdog 2>/dev/null
        return $rc
    fi
}

# Strict check: prints a friendly error and exits 1 on failure.
# Use at the start of any command that touches Docker.
require_docker() {
    if ! check_docker_installed; then
        err "docker 未安装"
        exit 1
    fi
    if ! check_docker_daemon_running; then
        err "docker daemon 未运行（请先启动 Docker Desktop）"
        exit 1
    fi
    if ! detect_compose_cmd; then
        err "未找到 docker-compose / docker compose"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# File / image existence
# ---------------------------------------------------------------------------
file_exists() { [ -f "$1" ]; }

# py_cmd <args...> — run a python interpreter on the rest of the args.
# Picks host python3 / python (no docker fallback; use run_python_step
# if you need that). Echoes the chosen interpreter; caller invokes it
# (this lets `set -e` track the python invocation, not the chooser).
py_cmd() {
    if command -v python3 &> /dev/null; then
        echo "python3"
    elif command -v python &> /dev/null; then
        echo "python"
    else
        err "未发现 python 或 python3"
        exit 1
    fi
}

require_file() {
    local path="$1"
    local hint="${2:-}"
    if [ ! -f "$path" ]; then
        err "$path 不存在"
        [ -n "$hint" ] && info "  → $hint"
        exit 1
    fi
}

# image_exists <name>  → returns 0 if Docker image is present locally.
image_exists() {
    docker image inspect "$1" &> /dev/null
}

# require_image <name> <fix-hint>  → exits 1 if missing, prints fix hint.
require_image() {
    local name="$1"
    local hint="${2:-run the appropriate build script first}"
    if ! image_exists "$name"; then
        err "image $name 未构建"
        info "  → $hint"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Random secret / default registry
# ---------------------------------------------------------------------------
# gen_secret <length>  → prints a URL-safe random string (no trailing newline).
# Tries python3 → openssl → /dev/urandom. Used by init scripts to seed
# SECRET_KEY / POSTGRES_PASSWORD so the resulting .env is immediately usable
# (user can still edit it afterwards).
gen_secret() {
    local len="${1:-48}"
    if command -v python3 &> /dev/null; then
        python3 -c "import secrets; print(secrets.token_urlsafe(${len}))"
    elif command -v openssl &> /dev/null; then
        # 4/3 expansion: 48 base64 chars ≈ 36 bytes of entropy. Trim padding.
        openssl rand -base64 $(( len * 3 / 4 )) | tr -d '\n=' | head -c "$len"
        echo
    else
        # Last-resort: urandom. Not URL-safe in the strict sense, but
        # sufficient as a placeholder the user will replace.
        tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$len"
        echo
    fi
}

# detect_default_registry  → prints "docker.io/<user>" (or "" if unknown).
# Used as a best-effort guess for DOCKER_REGISTRY when the user hasn't
# configured one. The user is expected to edit .env afterwards.
detect_default_registry() {
    local user="${USER:-}"
    if [ -z "$user" ] && command -v whoami &> /dev/null; then
        user=$(whoami 2>/dev/null || echo "")
    fi
    if [ -n "$user" ] && [ "$user" != "root" ]; then
        echo "docker.io/${user}"
    else
        # No usable username (root, container, no whoami): leave empty so
        # the user picks one explicitly. Empty = local-only mode.
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Port checks
# ---------------------------------------------------------------------------
# port_in_use <port>  → returns 0 if the port is listening, 1 otherwise.
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

# warn_port_in_use <port> <description>  → prints warning if occupied.
# Always returns 0: warnings are advisory, never fail the script under `set -e`.
warn_port_in_use() {
    local port="$1"
    local desc="$2"
    if port_in_use "$port"; then
        warn "$desc (端口 $port) 已被占用"
    fi
    return 0
}
