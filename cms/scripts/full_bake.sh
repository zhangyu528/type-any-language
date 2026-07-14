#!/usr/bin/env bash
#
# cms/scripts/full_bake.sh — one-line wrapper for the CMS pipeline +
# the db image bake. Kept as a thin shell script (instead of just a
# doc paragraph) so operators who learned the old "one-command full
# bake" workflow still have an entry point.
#
# Splits the old single `full_bake.sh` into two scripts:
#   1. cms/scripts/pipeline.sh — fills the staging db (vocab → sentences
#      → audio → export to SQL).
#   2. db/scripts/build.sh    — reads that staging db via
#      db/scripts/export_bundle.py and bakes the english_db_content
#      docker image.
#
# Run them separately when you want to iterate (e.g. fix one sentence
# without rebuilding the image), run this wrapper when you want the
# full "I changed CSVs, give me a fresh image" flow.
#
# Exit code: non-zero if either step fails (same as the underlying
# scripts).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

"$SCRIPT_DIR/pipeline.sh"
"$PROJECT_DIR/db/scripts/build.sh"