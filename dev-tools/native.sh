#!/usr/bin/env bash
#
# dev-tools/native.sh — host-native dev loop (default).
#
# 默认 dev 工作流:在宿主机上跑 backend (uvicorn --reload :8000) + frontend
# (next dev :3000),db 仍在 docker 里(localhost:5432)。绕开:
#   - frontend compose watch 的脆弱性(新建子目录 / 新顶层文件 sync 不稳;
#     冷启动 entrypoint hash-aware npm ci)
#   - backend dev 容器开销(~3s 启动,日志走 docker,debugger attach 烦)
#   - "build dev image 才能开始写代码" 的入场税
#
# Conventions match the old watch-process lifecycle pattern (.pid + .log at
# repo root, written by start, killed by stop, truncated on (re)start).
#
# Subcommands:
#   start              Start backend (uvicorn --reload :8000) + frontend
#                      (next dev :3000) on the host. Ensure docker db is up
#                      first (auto-start via ensure_dev_db_up).
#   start-frontend     Start ONLY frontend (next dev :3000). Useful for
#                      restart_frontend_dev.sh which kills orphans on :3000
#                      and brings up a single service. Doesn't touch backend.
#   stop               Stop both. Removes .pid files; logs are preserved.
#   restart|reload     stop + start.
#   status             Print pid + uptime + listening port + last log line.
#   logs [backend|frontend|both]
#                      Tail .local/native/logs/<svc>.log. Default: both.
#   preflight          Read-only check: python ≥ 3.11, node ≥ 20, npm, .venv,
#                      node_modules, docker daemon. Exits 0/1.
#
# Env knobs (any of these can be overridden at start time):
#   ALLOWED_ORIGINS       Defaults to "http://localhost,http://localhost:3000,
#                          http://localhost:54102,http://localhost:55407,
#                          http://localhost:55500" (matches compose default).
#   DATABASE_URL          If set in env, uses that. Else defaults to
#                          postgresql://english_dev:devpw@localhost:5432/english_dev
#                          (matches what docker-compose's db service exposes).
#   NEXT_PUBLIC_API_URL   Frontend reads it via next.config.js (see
#                          frontend/next.config.js). Defaults to
#                          http://localhost:${BACKEND_PORT:-8000}. ops no
#                          longer exports it — frontend self-resolves from
#                          BACKEND_PORT at next dev boot.
#   STRICT_PORT_CHECK=1   Make preflight fail on occupied :3000/:8000.
#   BACKEND_PORT / FRONTEND_PORT  Override (defaults 8000 / 3000).
#
# Lifecycle files (under repo-root .local/native/, gitignored):
#   .local/native/pids/backend.pid       .local/native/pids/frontend.pid
#   .local/native/logs/backend.log       .local/native/logs/frontend.log
#
# Exit codes: 0 ok; 1 preflight failed; 2 service already running / not running.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# PROJECT_DIR: prefer caller-supplied shell env, else derive from COMMON_DIR.
# Note: `cd "$COMMON_DIR/../.."` (one arg with embedded `../..`) is WRONG on
# Git Bash for Windows — MSYS collapses the nested `..` and lands one level
# too high. Two explicit `cd ..` (one per segment) sidesteps the MSYS quirk.
if [ -z "${PROJECT_DIR:-}" ]; then
    PROJECT_DIR="$(cd "$COMMON_DIR" && cd .. && pwd)"
fi
# Source _common.sh — it transitively sources lib.sh, so we get
# ok/warn/err/info + check_docker_installed/daemon + port_in_use + warn_port_in_use
# + dev_db_is_up / ensure_dev_db_up / warn_if_db_empty.
# We do NOT call setup_dev_host_env — that binds us to image tags / compose
# refs we don't need.
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"

# _common.sh's ensure_dev_db_up / dev_db_is_up assume $DOCKER_COMPOSE_CMD
# is set (by setup_dev_host_env). We don't want the rest of what
# setup_dev_host_env does (image tags, registry resolution), so just call
# detect_compose_cmd directly. Idempotent — no-op if already detected.
detect_compose_cmd || true

# ─── Constants ──────────────────────────────────────────────────────────────
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"

PID_DIR="$PROJECT_DIR/.local/native/pids"
LOG_DIR="$PROJECT_DIR/.local/native/logs"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

DEFAULT_ALLOWED_ORIGINS="http://localhost,http://localhost:3000,http://localhost:54102,http://localhost:55407,http://localhost:55500"
DEFAULT_DATABASE_URL="postgresql://english_dev:devpw@localhost:5432/english_dev"
# NEXT_PUBLIC_API_URL is resolved by frontend/next.config.js from BACKEND_PORT.
# ops no longer owns this default — see next.config.js for the source of truth.

# ─── Helpers ────────────────────────────────────────────────────────────────

# _alive <pid_file> — returns 0 if the pid in $1 is still running.
#
# On Git Bash on Windows the bundled `kill` is MSYS's and `kill -0 $pid`
# returns success for any positive integer (it doesn't actually query the
# host process table). With a stale .pid file that would let us stop a
# *different* live process or refuse to start a new one. Fall back to
# `tasklist` so a real Windows PID lookup is the source of truth.
_alive() {
    local pid_file="$1"
    [ -f "$pid_file" ] || return 1
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || echo "")"
    [ -n "$pid" ] || return 1
    if command -v tasklist >/dev/null 2>&1; then
        # Anchor the PID with surrounding whitespace so suffix collisions
        # (e.g. 1234 vs 12340) don't false-positive.
        local matches
        matches="$(tasklist //NH 2>/dev/null | grep -E "(^|[[:space:]])${pid}([[:space:]]|$)" || true)"
        [ -n "$matches" ] && return 0
        return 1
    fi
    kill -0 "$pid" 2>/dev/null
}

# _port_listener <port> — returns 0 if any process is LISTENING on <port>.
# Uses PowerShell Get-NetTCPConnection on Windows (netstat -ano on Windows
# is unreliable — it can miss LISTENING rows even when a socket is bound,
# per project debugging on the Win Git Bash MSYS env), and `ss -ltn` on
# Linux. Companion to _alive for the idempotent-start check: "running"
# means PID alive AND port actually serving (an orphan can satisfy just
# one of those — neither is enough alone to confidently reuse a service
# we did not start ourselves).
_port_listener() {
    local port="$1"
    if command -v powershell.exe >/dev/null 2>&1 && command -v netstat >/dev/null 2>&1; then
        # Windows: Get-NetTCPConnection is the source of truth (netstat
        # is flaky on Win Git Bash — verified empirically).
        powershell.exe -NoProfile -Command \
            "(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0" \
            2>/dev/null | tr -d '\r' | grep -q '^True$'
        return $?
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | grep -qE "[:.]${port}[[:space:]]"
        return $?
    fi
    if command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null \
            | grep -E "TCP[[:space:]]+0\.0\.0\.0:${port}:" \
            | grep -q LISTENING
        return $?
    fi
    return 1
}

# _uptime_for <pid> — returns "XmYs" if the pid is alive, "n/a" otherwise.
# On Git Bash on Windows the bundled `ps` is MSYS and doesn't support
# `-o etime=`, and there's no `/proc` to read from. We fall back to "n/a"
# on the Windows path — the alive/dead signal is `_alive`'s job.
_uptime_for() {
    local pid="$1"
    if command -v tasklist >/dev/null 2>&1; then
        echo "n/a"
        return 0
    fi
    local etime
    etime="$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ' || echo "")"
    if [ -z "$etime" ]; then
        echo "n/a"
        return 0
    fi
    # etime format from `ps -o etime=`: [[DD-]HH:]MM:SS — any prefix may
    # be omitted. Convert to total seconds ourselves so we don't depend on
    # `date -d` (which behaves differently on macOS).
    local days=0 hours=0 mins=0 secs=0 rest
    if [[ "$etime" == *-* ]]; then
        days="${etime%%-*}"
        rest="${etime#*-}"
    else
        rest="$etime"
    fi
    if [[ "$rest" == *:* ]]; then
        hours="${rest%%:*}"
        rest="${rest#*:}"
    fi
    mins="${rest%%:*}"
    secs="${rest#*:}"
    # Strip leading zeros for arithmetic (10#NN).
    days=$((10#$days)); hours=$((10#$hours)); mins=$((10#$mins)); secs=$((10#$secs))
    local total=$(( days * 86400 + hours * 3600 + mins * 60 + secs ))
    if [ "$total" -lt 0 ] || [ "$total" -gt 86400 ]; then
        echo "n/a"
    else
        local out_mins=$(( total / 60 ))
        local out_secs=$(( total % 60 ))
        echo "${out_mins}m${out_secs}s"
    fi
}

_ensure_layout() {
    mkdir -p "$PID_DIR" "$LOG_DIR"
}

# cmd_preflight — read-only checks. Exits non-zero on failure.
cmd_preflight() {
    local failed=0
    echo "=== native dev preflight ==="

    # Ports
    if [ "${STRICT_PORT_CHECK:-0}" = "1" ]; then
        if port_in_use "$FRONTEND_PORT"; then err ":$FRONTEND_PORT 被占"; failed=1; fi
        if port_in_use "$BACKEND_PORT";  then err ":$BACKEND_PORT 被占";  failed=1; fi
    else
        warn_port_in_use "$FRONTEND_PORT" "前端 dev 端口"
        warn_port_in_use "$BACKEND_PORT"  "后端 dev 端口"
    fi

    # Python
    local py=""
    if command -v python3 >/dev/null 2>&1; then
        py="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "")"
    elif command -v python >/dev/null 2>&1; then
        py="$(python -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "")"
    fi
    if [ -z "$py" ]; then
        err "找不到 python3 / python — native backend 需要"
        failed=1
    else
        case "$py" in
            3.11|3.12|3.13|3.14) ok "python $py" ;;
            *)                      warn "python $py (推荐 ≥ 3.11)";;
        esac
    fi

    # Node
    local node_v=""
    if command -v node >/dev/null 2>&1; then
        node_v="$(node --version 2>/dev/null | sed 's/^v//' || echo "")"
        case "$node_v" in
            2[0-9].*|1[8-9].*) ok "node $node_v" ;;
            *)                   warn "node $node_v (推荐 ≥ 20)";;
        esac
    else
        err "找不到 node — 需要 Node ≥ 20"
        failed=1
    fi
    if command -v npm >/dev/null 2>&1; then
        ok "npm $(npm --version 2>/dev/null)"
    else
        err "找不到 npm"
        failed=1
    fi

    # venv + deps (delegated to backend's own preflight)
    if [ -f "$BACKEND_DIR/scripts/preflight.py" ] && command -v python3 >/dev/null 2>&1; then
        if (cd "$BACKEND_DIR" && python3 scripts/preflight.py 2>&1); then
            : # preflight already prints ok/warn/err
        else
            err "backend preflight 返回非零 — 看上面"
            failed=1
        fi
    else
        err "backend/scripts/preflight.py 或 python3 缺失 — 重新跑 bash dev setup"
        failed=1
    fi

    # node_modules (delegated to frontend's own preflight; see frontend/package.json)
    if [ -f "$FRONTEND_DIR/package.json" ] && command -v npm >/dev/null 2>&1; then
        if (cd "$FRONTEND_DIR" && npm run preflight 2>&1); then
            : # preflight already prints ok/warn/err
        else
            err "frontend preflight 返回非零 — 看上面"
            failed=1
        fi
    else
        err "frontend/package.json 或 npm 缺失 — 重新跑 bash dev setup"
        failed=1
    fi

    # Docker (we still need it for the postgres container)
    if check_docker_installed; then
        ok "docker 已安装"
    else
        err "docker 未安装 — host-native 仍然依赖 docker postgres 容器"
        failed=1
    fi
    if check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行 — 启动 Docker Desktop"
        failed=1
    fi

    echo ""
    if [ $failed -eq 0 ]; then
        ok "preflight 通过"
        return 0
    fi
    err "preflight 失败 — 见上方 error"
    return 1
}

# _start_one <name> <pid_file> <log_file> <cmd...>
# Foreground-style spawn. Truncates log on (re)start. Verifies the child
# still lives 0.5s after spawn. The subshell + `&` + `disown` pattern is
# the same one used by start_compose_watch in _common.sh.
#
# On Windows Git Bash, `$!` returns the MSYS fake-PID of the bash subshell,
# not the real Windows PID of the spawned process — so a PID written from
# `$!` will not match anything in `tasklist`. We resolve the real PID
# afterward by image-name match (uvicorn -> python.exe, next dev -> node.exe).
_start_one() {
    local name="$1" pid_file="$2" log_file="$3"
    shift 3
    # Determine the port for this service: backend default 8000 (env override),
    # frontend always 3000 (next dev's port is passed explicitly).
    local port="$BACKEND_PORT"
    if [ "$name" = "frontend" ]; then port="$FRONTEND_PORT"; fi

    # Idempotent start: a service is "already running" iff
    #   (a) the PID file is alive AND the port has a listener,
    # — neither alone is enough. The PID file can be alive while the
    # port is free (uvicorn's reloader PID outlives the listener on
    # crash; any orphaned python.exe we never started), and the port
    # can have a listener we did NOT start (foreign process holding
    # our port). The "pid alive AND port listening" intersection is
    # the only signal we can trust — once satisfied, we skip spawn and
    # leave the existing instance alone. If only one of the two is
    # true, fall through to the orphan-sweep path below, which kills
    # whatever is on the port (or the orphan pid) and starts fresh.
    if _alive "$pid_file" && _port_listener "$port"; then
        info "$name 已在运行 (PID $(cat "$pid_file"), :$port)"
        return 0
    fi
    # PID file is stale (alive-but-port-free, or pid-is-dead). Drop it
    # so the spawn below can write a fresh one without the "already
    # running" check firing next time.
    if [ -f "$pid_file" ] && ! _alive "$pid_file"; then
        rm -f "$pid_file"
    fi

    # Orphan detector: port is bound but our PID file is missing/stale.
    # This catches leftover next dev / uvicorn from prior sessions that
    # never wrote a PID file under our contract. We loop the sweep
    # because a single kill is not always enough — Linux/Windows kernels
    # occasionally need a beat to recycle a TCP socket, and on Windows
    # the reloder PID uvicorn writes to .pid is NOT the listening PID
    # (the reloder PID leaves the listener PID in TIME_WAIT). Sweep
    # until :$port is actually free, with a small upper bound so a
    # persistent kernel-leaked socket doesn't loop forever.
    if _port_listener "$port"; then
        warn "$name 的 :$port 被占用 — 清扫中"
        local _sweep_iters=0
        while _port_listener "$port" && [ $_sweep_iters -lt 8 ]; do
            local orphan_pid
            if command -v powershell.exe >/dev/null 2>&1 && command -v netstat >/dev/null 2>&1; then
                orphan_pid="$(powershell.exe -NoProfile -Command \
                    "(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)" \
                    2>/dev/null | tr -d '\r' | head -n 1)"
            else
                orphan_pid="$(netstat -ano 2>/dev/null \
                    | grep -E "TCP[[:space:]]+0\.0\.0\.0:${port}:" \
                    | grep LISTENING | awk '{print $NF}' | head -n 1)"
            fi
            if [ -n "$orphan_pid" ] && [[ "$orphan_pid" =~ ^[0-9]+$ ]]; then
                info "  sweep :$port listener (PID $orphan_pid)"
                taskkill //PID "$orphan_pid" //F //T 2>/dev/null || true
                sleep 0.5
            fi
            _sweep_iters=$((_sweep_iters + 1))
        done
        if _port_listener "$port"; then
            err "  无法释放 :$port (8 次 sweep 后仍占用) — 查 Get-NetTCPConnection + tasklist"
            return 1
        fi
        # Also clean up any stale PID file so we don't re-adopt the orphan.
        rm -f "$pid_file"
    fi

    info "启动 $name → $log_file"
    : > "$log_file"
    # Subshell so the redirect is closed cleanly and we don't leak fd.
    (
        # shellcheck disable=SC2086
        "$@" >>"$log_file" 2>&1 &
        echo $! > "$pid_file"
    )
    sleep 0.5
    if command -v tasklist >/dev/null 2>&1; then
        # On Windows Git Bash, `$!` is the MSYS fake-PID of the bash subshell,
        # not the real Windows PID, so the value we just wrote won't match
        # anything in `tasklist`. Resolve the real PID by port + image-name
        # pairing: backend listens on 8000 / python.exe, frontend on 3000 /
        # node.exe. Prefer the port lookup (it picks the listener, not any
        # random node.exe), fall back to image newest if the port isn't
        # bound yet (e.g. slow first-compile).
        local port="$BACKEND_PORT"
        local image="python.exe"
        if [[ "$name" == "frontend" ]]; then port="$FRONTEND_PORT"; image="node.exe"; fi
        local real_pid=""
        # netstat -ano on Windows: column 5 is the PID for LISTENING rows.
        # Use the IPv4 0.0.0.0:port row to dodge the [::] IPv6 duplicate.
        if command -v netstat >/dev/null 2>&1; then
            real_pid="$(
                netstat -ano 2>/dev/null \
                    | grep -E "TCP[[:space:]]+0\.0\.0\.0:${port}:" \
                    | grep LISTENING \
                    | awk '{print $NF}' | head -n 1
            )"
        fi
        if [ -z "$real_pid" ] || ! [[ "$real_pid" =~ ^[0-9]+$ ]]; then
            # Fallback: newest process matching $image. `tasklist` returns
            # rows in process-creation order (oldest first), so `tail -n 1`
            # is the youngest. Good enough — the launch we just made is the
            # only new image of that name in the typical single-tenant box.
            real_pid="$(
                tasklist //FI "IMAGENAME eq $image" //NH //FO CSV 2>/dev/null \
                    | awk -F'","' '{print $2}' | tr -d '"' \
                    | tail -n 1
            )"
        fi
        if [ -n "$real_pid" ] && [[ "$real_pid" =~ ^[0-9]+$ ]]; then
            echo "$real_pid" > "$pid_file"
        fi
    fi
    # Second-pass PID correction: if the pid we captured (via image-name
    # fallback) was the shim — e.g. `npm run dev` exits after spawning the
    # real `next dev` — the listener PID is the one we want, and the shim
    # is dead. Poll one more time for the port listener before failing.
    if command -v tasklist >/dev/null 2>&1 && command -v netstat >/dev/null 2>&1; then
        local port="$BACKEND_PORT"
        if [[ "$name" == "frontend" ]]; then port="$FRONTEND_PORT"; fi
        local listener_pid
        listener_pid="$(
            netstat -ano 2>/dev/null \
                | grep -E "TCP[[:space:]]+0\.0\.0\.0:${port}:" \
                | grep LISTENING \
                | awk '{print $NF}' | head -n 1
        )"
        if [ -n "$listener_pid" ] && [[ "$listener_pid" =~ ^[0-9]+$ ]]; then
            if ! _alive "$pid_file" || [ "$(cat "$pid_file")" != "$listener_pid" ]; then
                echo "$listener_pid" > "$pid_file"
            fi
        fi
    fi
    if ! _alive "$pid_file"; then
        err "  $name 启动后立刻退出 — tail $log_file 看错"
        # Windows kernel-leaked socket detector. uvicorn/next-dev sometimes
        # fails to bind with WinError 10048 ("address in use") even though
        # the previous listener is dead and our sweep ran — the kernel
        # holds the socket in TIME_WAIT or a state invisible to tasklist.
        # Print the only two known escape hatches so the operator is not
        # stuck guessing. (Linux doesn't have this failure mode; the
        # netstat/ss grep above catches its orphans cleanly.)
        if grep -q "10048\|address in use\|Only one usage" "$log_file" 2>/dev/null; then
            err "  ↳ WinError 10048: 内核还在占着 :$port (kernel-leaked socket)"
            err "  ↳ 兜底(任选其一):"
            err "    1. 重启电脑 (最稳)"
            err "    2. netsh winsock reset  (会断网 + 需重启)"
            err "    3. 等 30s-2min 让内核回收 TIME_WAIT 后再试"
        fi
        return 1
    fi
    ok "  $name PID=$(cat "$pid_file")"
}

cmd_start_frontend() {
    if ! cmd_preflight >/dev/null; then
        err "preflight 失败 — 见下方详情:"
        cmd_preflight
        return 1
    fi
    _ensure_layout

    # Ensure docker postgres is up (self-heal, same pattern as import_content.sh).
    ensure_dev_db_up

    # Export env — frontend doesn't read DATABASE_URL. NEXT_PUBLIC_API_URL
    # is resolved by frontend/next.config.js from BACKEND_PORT, so ops
    # only needs to make sure BACKEND_PORT (if operator overrode it) is in
    # this process's env so the child npm run dev inherits it.
    export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$DEFAULT_ALLOWED_ORIGINS}"
    export DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
    # Pass-through: BACKEND_PORT → frontend dev inherits it.
    # If operator did NOT set BACKEND_PORT, leave it unset; next.config.js
    # defaults to 8000.
    [ -n "${BACKEND_PORT:-}" ] && export BACKEND_PORT

    # MSYS-safe spawn: pass paths as $1 positional args inside `bash -c '...'`
    # so Git Bash doesn't parse them as Windows paths (see project memory
    # docker-windows-single-slash-translation). The `cd` itself isn't a path-
    # translation pain point; only `npm run` chokes on D:/path args when they
    # land in the command string. Putting them in $1/$2 (positional args) keeps
    # them as variables inside the subshell, where cd + exec picks them up
    # without any path munging.
    #
    # `npm run dev` is the script defined in frontend/package.json ("dev":
    # "next dev"). The `--` here is npm's argument separator; the trailing
    # --port gets forwarded to `next dev` itself.
    _start_one "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_LOG" \
        bash -c 'cd "$1" && exec npm run dev -- --port "$2"' _ "$FRONTEND_DIR" "$FRONTEND_PORT"

    echo ""
    ok "frontend dev 已启动"
    echo -e "  前端: ${_LIB_BLUE}http://localhost:${FRONTEND_PORT}${_LIB_NC}"
    echo "  logs: tail -f $FRONTEND_LOG"
    echo "        (or: bash dev logs frontend)"
}

cmd_start() {
    if ! cmd_preflight >/dev/null; then
        err "preflight 失败 — 见下方详情:"
        cmd_preflight
        return 1
    fi
    _ensure_layout

    # Ensure docker postgres is up (self-heal, same pattern as import_content.sh).
    ensure_dev_db_up

    # Export env for both processes. Both children inherit it.
    # NEXT_PUBLIC_API_URL is resolved by frontend/next.config.js from
    # BACKEND_PORT (see next.config.js for the source of truth) — ops
    # only needs to pass BACKEND_PORT through if the operator set it.
    export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$DEFAULT_ALLOWED_ORIGINS}"
    export DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
    [ -n "${BACKEND_PORT:-}" ] && export BACKEND_PORT

    # MSYS-safe spawn: pass paths as $1 positional args inside `bash -c '...'`
    # so Git Bash doesn't parse them as Windows paths (see project memory
    # docker-windows-single-slash-translation).
    #
    # Backend dev is now `python3 scripts/dev.py` (delegates to dev.py
    # which does self-heal install + os.execvp uvicorn). This replaces
    # the old "source venv activate then exec uvicorn" pattern that
    # needed per-host Scripts/activate vs bin/activate detection.
    _start_one "backend" "$BACKEND_PID_FILE" "$BACKEND_LOG" \
        bash -c 'cd "$1" && exec python3 scripts/dev.py --port "$2"' _ "$BACKEND_DIR" "$BACKEND_PORT"
    # Delegate to cmd_start_frontend so the frontend spawn path stays in one place.
    cmd_start_frontend

    warn_if_db_empty  # reuses _common.sh helper
}

cmd_stop() {
    local killed=0
    for spec in "backend:$BACKEND_PID_FILE" "frontend:$FRONTEND_PID_FILE"; do
        local name="${spec%%:*}" pid_file="${spec##*:}"
        if _alive "$pid_file"; then
            local pid
            pid="$(cat "$pid_file")"
            info "停 $name (PID $pid)"
            kill "$pid" 2>/dev/null || true
            # Allow uvicorn/next to drain
            local _i
            for _i in 1 2 3 4 5 6 7 8 9 10; do
                if ! kill -0 "$pid" 2>/dev/null; then break; fi
                sleep 0.3
            done
            if kill -0 "$pid" 2>/dev/null; then
                warn "  $name 不响应 SIGTERM,送 SIGKILL via taskkill"
                # Git Bash's MSYS `kill` doesn't always reach Windows
                # processes; taskkill is the reliable path.
                taskkill //PID "$pid" //F 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
            fi
            rm -f "$pid_file"
            killed=1
        else
            [ -f "$pid_file" ] && rm -f "$pid_file"
            info "$name 没在运行"
        fi
    done
    if [ $killed -eq 1 ]; then
        ok "native dev 已停"
    else
        ok "native dev 本来就没在跑"
    fi
}

cmd_restart() { cmd_stop; cmd_start; }
cmd_reload()  { cmd_restart; }

cmd_status() {
    echo "=== native dev status ==="
    for spec in "backend:$BACKEND_PID_FILE:$BACKEND_PORT" "frontend:$FRONTEND_PID_FILE:$FRONTEND_PORT"; do
        local name="${spec%%:*}" rest="${spec#*:}"
        local pid_file="${rest%%:*}" port="${rest##*:}"
        if _alive "$pid_file"; then
            local pid
            pid="$(cat "$pid_file")"
            ok "$name: pid=$pid, uptime=$(_uptime_for "$pid"), :$port"
        else
            warn "$name: stopped"
        fi
    done
    # db (compose-managed, unchanged)
    if dev_db_is_up; then
        ok "db (docker compose): healthy"
    else
        warn "db (docker compose): not up — run: ./dev-tools/native.sh start (auto-heals)"
    fi
}

cmd_logs() {
    local which="${1:-both}"
    case "$which" in
        backend)        tail -n 200 -f "$BACKEND_LOG" ;;
        frontend)       tail -n 200 -f "$FRONTEND_LOG" ;;
        both|"")        tail -n 100 -f "$BACKEND_LOG" "$FRONTEND_LOG" ;;
        *) err "未知服务: $which (用 backend|frontend|both)"; return 1 ;;
    esac
}

usage() {
    cat <<EOF
用法: ./dev-tools/native.sh <command>

命令:
  start             在宿主机上启动 backend (uvicorn :$BACKEND_PORT) + frontend (next dev :$FRONTEND_PORT)
  stop              停掉两个进程
  restart|reload    stop + start
  status            各服务 PID / uptime / port / 健康
  logs [backend|frontend|both]  tail 日志 (default: both)
  preflight         只做检查,不启动 (exit 0/1)

环境变量:
  ALLOWED_ORIGINS     默认 $DEFAULT_ALLOWED_ORIGINS
  DATABASE_URL        默认 $DEFAULT_DATABASE_URL
  NEXT_PUBLIC_API_URL 由 frontend/next.config.js 从 BACKEND_PORT 解析 (ops 不再 export)
  STRICT_PORT_CHECK=1 preflight 看到端口被占就 fail
  BACKEND_PORT / FRONTEND_PORT  覆盖

典型工作流:
  bash dev setup            # 装 venv + node_modules + (lazy) docker image build
  bash dev start            # native start
  ...改代码,看热重载...
  bash dev stop

想测 docker image 路径:
  bash dev start            # docker db 也随 start 一起拉起
EOF
}

case "${1:-}" in
    start)            shift; cmd_start "$@" ;;
    start-frontend)   shift; cmd_start_frontend "$@" ;;
    stop)             shift; cmd_stop "$@" ;;
    restart|reload)   shift; cmd_restart "$@" ;;
    status)           shift; cmd_status "$@" ;;
    logs)             shift; cmd_logs "$@" ;;
    preflight)        shift; cmd_preflight "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
