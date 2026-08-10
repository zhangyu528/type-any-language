#!/usr/bin/env bash
#
# dev/logs.sh — docker compose logs -f for dev.
#
# Read-only wrapper around `docker compose logs -f`.
#
# Usage:
#   ./dev/logs.sh                  # all services
#   ./dev/logs.sh backend          # one service
#   ./dev/logs.sh --tail 100 backend

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

require_docker
exec $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
