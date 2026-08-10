#!/usr/bin/env bash
#
# ops/cvm/preflight.sh — read-only env check for the prod CVM.
#
# Verifies docker / compose / port 80 are ready. Exits 1 on any failure.
# Does NOT modify anything on disk or bring containers up/down.
#
# Run standalone:    ./ops/cvm/preflight.sh
# Also called from:  bootstrap.sh::cmd_prepare

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"

info "=== preflight ==="
failed=0

if check_docker_installed; then
    ok "docker 已安装: $(docker --version 2>&1 | head -1)"
else
    err "docker 未安装"; failed=1
fi

if check_docker_daemon_running; then
    ok "docker daemon 运行中"
else
    err "docker daemon 未运行"; failed=1
fi

if detect_compose_cmd 2>/dev/null; then
    ok "compose: $DOCKER_COMPOSE_CMD"
else
    err "未找到 docker-compose / docker compose"; failed=1
fi

warn_port_in_use 80 "nginx 端口 (宿主机 80)"

if [ "$failed" -ne 0 ]; then
    err "preflight 失败 — 修好后重跑"
    exit 1
fi
ok "preflight OK"
