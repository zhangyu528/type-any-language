#!/usr/bin/env bash
#
# Tear down the ephemeral staging stack.
# Always succeeds (never fails the workflow) - even if stack is already down.
# Used by staging.yml (mode: validate | review).

cd "$(dirname "$0")"

echo "[teardown-staging] stopping stack..."
docker compose -p tal-staging down -v --remove-orphans 2>/dev/null || true
echo "[teardown-staging] done."
# publish-prod.yml then reads this record to assert staging was verified.
