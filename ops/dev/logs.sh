#!/usr/bin/env bash
#
# ops/dev/logs.sh — docker compose logs -f for dev.
#
# Read-only wrapper around `docker compose logs -f`. Compose evaluates
# the full file even for read-only ops, so we populate DB_USER / DB_NAME
# (or fall back to bake defaults).
#
# Usage:
#   ./ops/dev/logs.sh                  # all services
#   ./ops/dev/logs.sh backend          # one service
#   ./ops/dev/logs.sh --tail 100 backend

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

require_docker
export_db_identity_for_compose
exec $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
