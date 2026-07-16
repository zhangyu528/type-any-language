#!/usr/bin/env bash
#
# ops/prod/logs.sh — docker compose logs -f for prod.
#
# Read-only wrapper. Usage:
#   ./ops/prod/logs.sh                  # all services
#   ./ops/prod/logs.sh backend          # one service
#   ./ops/prod/logs.sh --tail 100 backend

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

require_docker
exec $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
