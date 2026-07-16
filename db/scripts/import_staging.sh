#!/bin/bash
#
# db/scripts/import_staging.sh — read CMS staging files and apply to
# the staging db. The bridge between "CMS pipeline produced files"
# and "the db has the new content".
#
# Why this lives in db/scripts/:
#   This is the inverse of db/scripts/build.sh's export_bundle.py.
#   The data flow is:
#     CMS pipeline →  cms/staging/  →  importer  →  db
#   The importer is the one place that knows both file format and
#   schema, so it lives with the schema (db/tools/dbtools/). This
#   shell is its entry point.
#
# Idempotent: re-running only inserts new rows; existing rows are
# skipped (vocab) or updated in place (sentences, audio_url).
# Safe to re-run after editing CSVs or after the TTS step fills
# in audio_url.
#
# Usage:
#   ./db/scripts/import_staging.sh               # all in one go
#   ./db/scripts/import_staging.sh vocab        # just vocab tables
#   ./db/scripts/import_staging.sh sentences   # just sentences (incl. audio_url)
#   ./db/scripts/import_staging.sh --dry-run    # show what would happen
#
# Make sure a populated db is reachable first:
#   ./db/scripts/source_db.sh ensure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# PYTHONPATH=db/tools — the importer lives at db/tools/dbtools/.
PYTHONPATH="${PROJECT_DIR}/db/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m dbtools.importer "$@"