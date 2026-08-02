#!/usr/bin/env bash
#
# ops/dev/restart_frontend_dev.sh — 仅重启 frontend dev,**不**碰 backend。
#
# 为什么要单独搞一个,因为 native.sh restart 只通过 pid file 杀进程。
# "orphan" 场景(进程还活着但 pid file 丢了 / 写错了 / 被别的 script 删了)
# 不会被原生 restart 处理 — 端口 :3000 仍被占,start 直接报 "端口被占" 退出,
# 用户得手工 taskkill,然后再调 start。本脚本把这两步合并成一个命令。
#
# 另一个动机:native.sh start 会同时拉 backend (uvicorn) + frontend。
# 平时 frontend 改动热重载就够了,不需要把 backend 也踢一遍。
# 所以 Step 3 调 native.sh start-frontend — 只起 frontend。
#
# 工作流(全部幂等):
#   1) 通过 pid file 杀 — 找到 .native-pids/frontend.pid,沿用 native.sh
#      同一套 drain loop (kill -TERM, 等 3s, taskkill //F 兜底)
#   2) 端口兜底 — 用 netstat -ano 在 Win Git Bash 必返回的 listening 行
#      抓 orphan PID, taskkill //F(注意:不能用 ops/lib.sh 的 port_in_use,
#      那个在 Windows 上有 bug — netstat -tln 漏 LISTENING)
#   3) 调用 native.sh start-frontend 拉起新的 next dev
#
# Env knobs(与 native.sh 一致):
#   FRONTEND_PORT  默认 3000
#
# Exit codes: 0 ok; 1 start failed (port 不释放等)。
set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=/dev/null
source "$PROJECT_DIR/ops/lib.sh"

# _common.sh 推导出 PID_DIR,但 native.sh 不在那里,而是单独重新赋值。
# 直接 hardcode 默认路径,跟 native.sh:69 保持一致。
FRONTEND_PID_FILE="${FRONTEND_PID_FILE:-$PROJECT_DIR/.native-pids/frontend.pid}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# _port_listening_pids <port> — 输出当前 LISTEN 该 port 的 pid 列表(行内)。
# 用 netstat -ano(不 -tln;后者在 win Git Bash 漏 LISTENING 行)。
# [:.]port 后跟空格避免 3000 误匹配 30000。
# 末列 = pid;sort -u 去 IPv4/IPv6 重复。
_port_listening_pids() {
    local port="$1"
    netstat -ano 2>/dev/null \
        | grep -E "[:.]${port} " \
        | grep -i LISTENING \
        | awk '{print $NF}' \
        | sort -u \
        | grep -v '^0$' \
        | grep -v '^$'
}

info "restart frontend (port $FRONTEND_PORT)"

# ------------------------------------------------------------
# Step 1: pid file 杀 — 复用 native.sh cmd_stop 同 pattern。
# ------------------------------------------------------------
kill_pid_file() {
    local pid_file="$1" name="$2"
    if [ ! -f "$pid_file" ]; then
        return 0
    fi
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -z "$pid" ]; then
        rm -f "$pid_file"
        return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        # pid file 残留但 pid 已死 — 清掉。
        info "  pid file 残留(pid $pid 已死),清掉"
        rm -f "$pid_file"
        return 0
    fi
    info "  按 pid file 停 $name (PID $pid)"
    kill "$pid" 2>/dev/null || true
    local _i
    for _i in 1 2 3 4 5 6 7 8 9 10; do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 0.3
    done
    if kill -0 "$pid" 2>/dev/null; then
        warn "  $name 不响应 SIGTERM — taskkill //F"
        taskkill //PID "$pid" //F 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
}
kill_pid_file "$FRONTEND_PID_FILE" "frontend"

# ------------------------------------------------------------
# Step 2: 端口兜底 — orphan 占着 :3000 时强制清。
# 注意:即使 Step 1 走通了,有时 child 子进程还在持有 port(MSYS fake-PID
# 不等于 Windows 真实 PID);所以这一步无条件再扫一次。
# ------------------------------------------------------------
orphans="$(_port_listening_pids "$FRONTEND_PORT" || true)"
if [ -n "$orphans" ]; then
    warn "  :$FRONTEND_PORT 仍 LISTEN — 抓 orphan 进程"
    for pid in $orphans; do
        # 双重过滤:listening 行末字段偶尔不是合法 pid
        # trim 掉可能夹带的 \r / 空白
        pid="$(echo "$pid" | tr -d '[:space:]')"
        if [ -z "$pid" ] || [ "$pid" = "0" ]; then continue; fi
        # 跳过 kill -0 探测:MSYS bash 的 fake-PID 用 kill -0 探 native
        # Windows PID 经常返回失败(node.exe 实存在却被报死),导致 taskkill
        # 跳过。这里靠 taskkill 自身对死 pid 的返回码(128)做兜底即可。
        info "  taskkill //F orphan PID $pid"
        # 不吞 stderr — 上次脚本静默失败,不易诊断
        if ! taskkill //PID "$pid" //F 2>/dev/null; then
            warn "  taskkill PID $pid 失败,改用 kill -9 兜底"
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
    # Drain — 端口释放需要 OS 回收时间。
    for _i in 1 2 3 4 5 6 7 8 9 10; do
        if [ -z "$(_port_listening_pids "$FRONTEND_PORT" || true)" ]; then break; fi
        sleep 0.3
    done
    if [ -n "$(_port_listening_pids "$FRONTEND_PORT" || true)" ]; then
        err "  :$FRONTEND_PORT 仍占用 — 退出前自己 taskkill"
        exit 1
    fi
fi

# ------------------------------------------------------------
# Step 3: 拉起新的 — 只起 frontend,不碰 backend。
# ------------------------------------------------------------
info "  启动 frontend"
bash "$COMMON_DIR/native.sh" start-frontend

ok "frontend 已重启"
info "  tail: tail -f .native-logs/frontend.log"
