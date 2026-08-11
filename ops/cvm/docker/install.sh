#!/usr/bin/env bash
#
# ops/cvm/docker/install.sh — install Docker Engine + Compose plugin.
#
# Idempotent:
#   - docker installed + daemon running       → exit 0 (no-op)
#   - docker installed but daemon not running → try systemctl start
#   - docker not installed                    → install via apt-get / dnf / yum
#
# Supports apt-get (Debian/Ubuntu), dnf (modern RHEL/Fedora), and yum
# (legacy RHEL/CentOS). For other distros, prints manual instructions
# and exits 1.
#
# Run standalone:    ./ops/cvm/docker/install.sh
# Also called from:  bootstrap.sh::cmd_prepare (auto-installs on a fresh CVM)

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_common.sh
source "$COMMON_DIR/../_common.sh"

# ─── 1. Already-installed fast paths ───────────────────────────────────
if check_docker_installed && check_docker_daemon_running; then
    ok "docker 已安装且 daemon 运行中: $(docker --version 2>&1 | head -1)"
    _verify_compose_plugin
    exit 0
fi

if check_docker_installed && ! check_docker_daemon_running; then
    warn "docker 已安装但 daemon 未运行 — 尝试启动..."
    if command -v systemctl >/dev/null 2>&1; then
        sudo_run_or_manual systemctl enable docker || true
        sudo_run_or_manual systemctl start docker || true
    fi
    if check_docker_daemon_running; then
        ok "docker daemon 已启动"
        _verify_compose_plugin
        exit 0
    fi
    err "docker daemon 启动失败 — 自己排查: systemctl status docker"
    info "  (CVM 通常是 systemd 缺失/未启 — 检查 /var/log/messages 或 cloud-init log)"
    exit 1
fi

# ─── 2. Install from package manager ────────────────────────────────────
info "=== docker install ==="
info "未检测到 docker,准备安装..."

if command -v apt-get >/dev/null 2>&1; then
    info "检测到 apt-get — 装 docker.io + docker-compose-plugin (Debian/Ubuntu 官方仓库)"
    sudo_run_or_manual apt-get update -y || exit 1
    sudo_run_or_manual apt-get install -y docker.io docker-compose-plugin || exit 1
elif command -v dnf >/dev/null 2>&1; then
    info "检测到 dnf — 装 docker + docker-compose-plugin (modern RHEL/Fedora)"
    sudo_run_or_manual dnf install -y docker docker-compose-plugin || exit 1
elif command -v yum >/dev/null 2>&1; then
    info "检测到 yum — 装 docker + docker-compose-plugin (legacy RHEL/CentOS)"
    sudo_run_or_manual yum install -y docker docker-compose-plugin || exit 1
else
    err "未检测到 apt-get / dnf / yum — 此脚本不支持该发行版"
    info "  自己装 (Debian/Ubuntu):  sudo apt-get install docker.io docker-compose-plugin"
    info "  自己装 (RHEL/Fedora):    sudo dnf install docker docker-compose-plugin"
    info "  或装 Docker CE 官方版: https://docs.docker.com/engine/install/"
    exit 1
fi

# ─── 3. Enable + start service ─────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
    sudo_run_or_manual systemctl enable docker || true
    sudo_run_or_manual systemctl start docker || {
        err "docker daemon 启动失败"
        info "  自己排查: sudo systemctl status docker"
        exit 1
    }
else
    warn "未检测到 systemctl — 假设 docker 会被其他机制拉起 (openrc / sysvinit)"
fi

# ─── 4. Verify ──────────────────────────────────────────────────────────
if ! check_docker_installed; then
    err "docker 安装后仍找不到 docker 二进制"
    exit 1
fi
if ! check_docker_daemon_running; then
    err "docker 已安装但 daemon 未运行"
    info "  自己排查: sudo systemctl status docker"
    exit 1
fi

ok "docker 安装完成: $(docker --version 2>&1 | head -1)"
_verify_compose_plugin

# _verify_compose_plugin — print info about the compose backend the install
# landed on. docker compose v2 (plugin) is the modern default; legacy
# docker-compose v1 (Python) still works on older distros but the rest of
# ops/cvm/ assumes v2.
_verify_compose_plugin() {
    if docker compose version >/dev/null 2>&1; then
        ok "docker compose (v2, plugin) 可用: $(docker compose version 2>&1 | head -1)"
        return 0
    fi
    if command -v docker-compose >/dev/null 2>&1; then
        warn "只装了 legacy docker-compose v1 — ops/cvm/lifecycle.sh 默认调 docker compose v2"
        info "  自己装 v2 plugin: sudo apt-get install docker-compose-plugin"
        info "  (或显式设置 DOCKER_COMPOSE_CMD=docker-compose — 但 lifecycle.sh 会失败)"
        return 0
    fi
    err "docker compose 既没装 plugin 也没装 v1 binary — ops/cvm/lifecycle.sh 会失败"
    info "  自己装: sudo apt-get install docker-compose-plugin"
    exit 1
}
