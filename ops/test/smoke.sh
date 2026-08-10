#!/usr/bin/env bash
#
# Smoke test against a running deployment.
# Called by staging.yml (mode: validate) and smoke-test.yml.
#
# Usage: bash ops/test/smoke.sh <base-url>
#   <base-url>  e.g. http://localhost:8080  (nginx entry point)
#
# Runs a set of lightweight HTTP probes (frontend root, API docs, an API
# endpoint). Exits 0 if all probes pass, 1 otherwise.

set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "::error::usage: smoke.sh <base-url>" >&2
  exit 2
fi

# Strip any trailing slash so path joins are clean.
BASE_URL="${BASE_URL%/}"

echo "[smoke] target: $BASE_URL"

probe() {
  local name="$1"
  local path="$2"
  local url="${BASE_URL}${path}"
  if curl -fsS --max-time 15 "$url" >/dev/null 2>&1; then
    echo "  [ok]   $name  $url"
    return 0
  fi
  echo "  [FAIL] $name  $url" >&2
  return 1
}

fail=0
probe "frontend root"      "/"                     || fail=1
probe "backend api docs"   "/api/docs"             || fail=1
probe "backend vocabulary" "/api/vocabulary/libs"  || fail=1

if [ "$fail" -ne 0 ]; then
  echo "::error::smoke test FAILED" >&2
  exit 1
fi

echo "[smoke] all probes passed"
