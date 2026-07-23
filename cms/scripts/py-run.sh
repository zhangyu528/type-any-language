#!/usr/bin/env bash
#
# py-run.sh — set PYTHONPATH/PYTHONIOENCODING once and exec python3 -m
# <module-name> "<args>...".
#
# Lets every cmd_*.sh avoid exporting env vars individually.
# Usage:
#   "$SCRIPT_DIR/py-run.sh" pipeline.import_vocab --lib ielts
#   "$SCRIPT_DIR/py-run.sh" pipeline.generate_sentences ...
#   "$SCRIPT_DIR/py-run.sh" importer all
#
# PYTHONPATH must include cms/ and db/ — pipeline modules live at
# cms/pipeline/, schema/migration runner at backend/migrations/,
# importer at db/importer.py (plus db_url.py for the defensive fallback).
# All three directories (cms, backend, db) must be on the path so the
# module set can resolve either kind of import.
#
# PYTHONIOENCODING=utf-8 prevents Windows console GBK decoding from
# crashing on Unicode box-drawing / ✓ / ✗ characters. No-op on
# Linux / macOS.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use git rev-parse, NOT `cd "$SCRIPT_DIR/../.."` — the latter breaks
# under Git Bash on Windows because the `..` resolution eats a
# hyphenated path segment (e.g. `type-any-language` resolves as one
# level up instead of two). Same fix as cms/run.sh + staging.sh.
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

# cms, backend, and db must all be importable from this process.
# cms           — owns cms/pipeline/*.py (data production)
# backend       — owns backend/migrations/runner.py (entrypoint imports the
#                 runner; PYTHONPATH=backend lets `python -m
#                 backend.migrations.runner` resolve if invoked via that path;
#                 in practice we invoke it as `python -m migrations.runner`)
# db            — owns db/{importer,db_url}.py (for L step imports)
#
# Path separator: Python uses os.pathsep, which is `:` on POSIX and `;`
# on Windows. Hard-coding `:` works on Linux/macOS (and Git Bash —
# Python's lib uses forward slashes) but breaks on Windows native
# python.exe. Use `pathsep` from `python3 -c` so we get the right
# value regardless of OS:
pathsep="$(python3 -c 'import os; print(os.pathsep)')"
export PYTHONPATH="${PROJECT_DIR}/cms${pathsep}${PROJECT_DIR}/backend${pathsep}${PROJECT_DIR}/db${PYTHONPATH:+${pathsep}${PYTHONPATH}}"
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# First arg is the module path (e.g. "pipeline.import_vocab", "importer",
# "backend.migrations.runner"). We strip it from the args list and pass it
# to `python3 -m <module>` so Python actually imports it as a module
# instead of trying to open it as a file path.
module="$1"
shift || {
    err "usage: $SCRIPT_DIR/py-run.sh <module.path> [args...]"
    exit 2
}

exec python3 -m "$module" "$@"
