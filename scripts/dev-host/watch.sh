#!/usr/bin/env bash
#
# scripts/dev-host/watch.sh — foreground `docker compose watch`.
#
# For users who want to SEE the sync events in their terminal (Ctrl+C to
# stop). `lifecycle.sh start` already auto-spawns a background watch —
# running this in another terminal is fine too.
#
# The background watch's PID/log live at:
#   .compose-frontend-watch.pid
#   .compose-frontend-watch.log

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_watch_foreground
