#!/bin/bash
#
# db/scripts/init_schema.sh — apply the base schema to a fresh source
# db. Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
# EXISTS).
#
# Why this lives in db/scripts/ instead of cms/scripts/:
#   Schema definition is a db concern. The Python implementation
#   (init_schema.py + migrations/) now lives at db/tools/cms/ —
#   the schema and migration versions are owned by the db side.
#   cms/cms_pipeline/ remains for the data-pipeline code only
#   (import_vocab, generate_sentences, generate_audio, ...).
#
#   This shell script is the db-side entry point. It shells out
#   to `python -m dbtools.init_schema` — same package name ("cms")
#   as before, just resolved against a different directory.
#
# Usage:
#   # 1. Make sure a populated db is reachable (cms-source-db or local).
#   ./db/scripts/source_db.sh ensure
#   # 2. Apply the base schema.
#   ./db/scripts/init_schema.sh
#
# Idempotent: safe to re-run on a db that already has the tables.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# PYTHONPATH=db/tools — the init_schema + migrations Python package
# lives at db/tools/dbtools/. The package name is "dbtools" (distinct
# from the data-pipeline's "cms" package so the two can coexist on
# PYTHONPATH without import shadowing).
PYTHONPATH="${PROJECT_DIR}/db/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m dbtools.init_schema "$@"