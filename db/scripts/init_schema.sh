#!/bin/bash
#
# db/scripts/init_schema.sh — apply the base schema to a fresh source
# db. Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
# EXISTS).
#
# Why this lives in db/scripts/ instead of cms/scripts/:
#   Schema definition is a db concern. The Python implementation
#   happens to live in cms/tools/cms/ (because the schema was
#   historically managed alongside the content pipeline), but the
#   "when to apply schema" decision is db's — db needs a populated
#   schema before it can read content out of a fresh source db.
#
#   This shell script is the db-side entry point. It shells out to
#   the CMS-hosted Python module (same pattern as db/scripts/build.sh
#   shelled out to export_bundle.py before that file was moved).
#
#   In an ideal world the Python would also live in db/; for now it
#   stays in cms/tools/cms/ to keep the schema definition next to
#   migration versions (cms/tools/cms/migrations/).
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

# PYTHONPATH=cms/tools — same as cms/scripts/content.sh uses, so
# `python -m cms.init_schema` resolves.
PYTHONPATH="${PROJECT_DIR}/cms/tools${PYTHONPATH:+:$PYTHONPATH}" \
    python3 -m cms.init_schema "$@"