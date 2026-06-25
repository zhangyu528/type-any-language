#!/bin/bash
#
# ./dev — root-level entry for dev host operations.
#
# Thin wrapper around scripts/ops/dev-host/run.sh. Use this when you want
# a short, memorable command from the project root:
#
#   ./dev setup          # first-time: 拉/检查 db image, build dev app images
#   ./dev doctor         # pre-flight
#   ./dev start          # compose up (auto-pull db image if DOCKER_REGISTRY set)
#   ./dev stop
#   ./dev restart        # hard restart (recreate + re-read secrets)
#   ./dev logs
#   ./dev status
#
# Equivalent to running scripts/ops/dev-host/run.sh <subcommand> directly.
# `exec` replaces this shell so signals (Ctrl+C) propagate to the child.
#
# Exit codes / behaviour are identical to the underlying script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/scripts/ops/dev-host/run.sh" "$@"
