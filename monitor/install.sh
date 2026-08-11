#!/usr/bin/env bash
#
# monitor/install.sh - install the CVM monitor monitor as a systemd service.
#
# Idempotent. Safe to re-run after edits to web/dist/ (just restarts the service).
#
# Run on the CVM as the deploy user (or with sudo):
#   bash /opt/type-any-language/monitor/install.sh
#
# What it does:
#   1. Verifies python3 + docker are on PATH (the runtime requirements).
#   2. Creates /opt/type-any-language/monitor as the install root.
#   3. Installs the systemd unit from systemd/tal-monitor.service.
#   4. daemon-reload + enable + (re)start the service.
#   5. Prints the dashboard URL + how to tail logs / stop the service.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_DIR="$PROJECT_DIR/monitor"
SERVICE_NAME="tal-monitor.service"
SYSTEMD_DIR="/etc/systemd/system"

info() { printf '[monitor-install] %s\n' "$*"; }
err()  { printf '[monitor-install] ERROR: %s\n' "$*" >&2; }

# --- preflight ---------------------------------------------------------------
for cmd in python3 systemctl docker; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        err "missing required command: $cmd"
        case "$cmd" in
            docker) info "  install via ops/cvm/docker/install.sh or 'apt install docker.io docker-compose-plugin'" ;;
            python3) info "  install via 'apt install python3' (Ubuntu/Debian)" ;;
            systemctl) err "  systemctl missing — this script requires a systemd-based CVM" ;;
        esac
        exit 1
    fi
done

if [ ! -d "$MONITOR_DIR/web/dist" ]; then
    err "web/dist/ not found at $MONITOR_DIR/web/dist"
    info "  on the dev host: cd web && npm install && npm run build"
    info "  then commit web/dist/ and re-run this script"
    exit 1
fi

# --- install unit ------------------------------------------------------------
if [ ! -f "$MONITOR_DIR/systemd/$SERVICE_NAME" ]; then
    err "systemd unit missing: $MONITOR_DIR/systemd/$SERVICE_NAME"
    exit 1
fi

info "installing systemd unit: $SYSTEMD_DIR/$SERVICE_NAME"
sudo install -m 0644 "$MONITOR_DIR/systemd/$SERVICE_NAME" "$SYSTEMD_DIR/$SERVICE_NAME"

# --- reload + enable + (re)start ----------------------------------------------
info "daemon-reload + enable + restart"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null
sudo systemctl restart "$SERVICE_NAME"

# --- wait for boot ----------------------------------------------------------
info "waiting for service to become healthy (max 10s)..."
for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null "http://127.0.0.1:9090/api/v1/monitor/version" 2>/dev/null; then
        ok=1; break
    fi
    sleep 1
done

# --- summary ----------------------------------------------------------------
cat <<EOF

[monitor-install] ✓ installed

  dashboard:  http://127.0.0.1:9090
  api root:   http://127.0.0.1:9090/api/v1/monitor/snapshot
  service:    sudo systemctl status $SERVICE_NAME
  logs:       sudo journalctl -u $SERVICE_NAME -f
  stop:       sudo systemctl stop $SERVICE_NAME

  the dashboard binds to 127.0.0.1 only (loopback). for remote
  access, use an ssh tunnel:  ssh -L 9090:127.0.0.1:9090 <cvm>
EOF
