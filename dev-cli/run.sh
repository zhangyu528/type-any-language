#!/usr/bin/env bash
#
# dev/cli/run.sh — thin bash wrapper that invokes the Node multiplexer.
#
# We `exec node` so the wrapper process is replaced — Node handles
# SIGINT cleanly; if we kept bash as a parent, Ctrl+C would propagate
# through bash first, which is unreliable on Windows Git Bash.

set -e
COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$COMMON_DIR/run.js" "$@"