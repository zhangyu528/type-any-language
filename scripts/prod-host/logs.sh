#!/usr/bin/env bash
#
# scripts/prod-host/logs.sh — docker compose logs -f for prod.
#
# Read-only wrapper. Usage:
#   ./scripts/prod-host/logs.sh                  # all services
#   ./scripts/prod-host/logs.sh backend          # one service
#   ./scripts/prod-host/logs.sh --tail 100 backend

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

require_docker
exec $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
