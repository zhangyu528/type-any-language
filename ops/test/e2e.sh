#!/usr/bin/env bash
#
# End-to-end test against a running deployment using Playwright.
# Called by staging.yml (mode: validate) and e2e-test.yml.
#
# Usage: bash ops/test/e2e.sh <base-url>
#   <base-url>  e.g. http://localhost:8080  (nginx entry point)
#
# Behavior:
#   - If frontend/ contains a Playwright config + specs, run them against
#     <base-url> (BASE_URL is forwarded to the Playwright runner).
#   - If no e2e specs exist yet, print a notice and exit 0 (treated as a
#     skip, not a failure) so the pipeline does not break before tests
#     are written.

set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "::error::usage: e2e.sh <base-url>" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FE_DIR="$REPO_ROOT/frontend"

if [ ! -d "$FE_DIR" ]; then
  echo "[e2e] no frontend/ workspace found — skipping (nothing to run)"
  exit 0
fi

# Detect a Playwright config (common file names).
CONFIG=""
for c in playwright.config.ts playwright.config.js playwright.config.mjs; do
  if [ -f "$FE_DIR/$c" ]; then CONFIG="$c"; break; fi
done

if [ -z "$CONFIG" ]; then
  echo "[e2e] no Playwright config in frontend/ — skipping e2e (no tests yet)"
  exit 0
fi

echo "[e2e] running Playwright ($CONFIG) against $BASE_URL ..."
cd "$FE_DIR"
export BASE_URL
npx playwright test --reporter=line
