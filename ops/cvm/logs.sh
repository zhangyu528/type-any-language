#!/usr/bin/env bash
#
# ops/cvm/logs.sh — docker compose logs -f for the CVM stack.
#
# Read-only wrapper. Usage:
#   ./ops/cvm/logs.sh                  # all services
#   ./ops/cvm/logs.sh backend          # one service
#   ./ops/cvm/logs.sh --tail 100 backend
#
# Only covers the compose services (db / backend / frontend). The
# host's system nginx logs live in /var/log/nginx/.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

require_docker
compose logs -f "$@"
