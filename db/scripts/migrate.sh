#!/bin/bash
#
# db/scripts/migrate.sh — apply pending schema migrations to the
# connected db. Idempotent (runner.py stamps applied versions in
# schema_migrations; re-runs are no-ops).
#
# Where the migration Python code lives:
#   The runner + versions/ live at backend/migrations/. db/scripts/
#   keeps this entry-point shell wrapper so the operator workflow
#   (`./db/scripts/migrate.sh` from any host) doesn't change.
#
# Default usage:
#   DATABASE_URL is expected in env. Two ways to set it:
#   - container: compose sets DATABASE_URL via the environment: block,
#     runs this script (or its caller) — typically via the backend
#     image's entrypoint.sh.
#   - host shell: `export DATABASE_URL=postgresql://user:pw@host:5432/db`
#     before running. For self-hosted / CI / ad-hoc CLI use.
#
#   # Self-hosted postgres without DATABASE_URL pre-set:
#   POSTGRES_PASSWORD=... ./db/scripts/migrate.sh
#
# Idempotent: stamped schema migrations are skipped; migrations that explicitly
# declare `rerunnable = True` re-run their idempotent data backfills.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Self-contained: db/scripts owns its helpers (db_assemble_url + logging),
# no ops/ dependency.
source "$SCRIPT_DIR/lib.sh"

# Assemble DATABASE_URL — see db/scripts/lib.sh::db_assemble_url. The runner
# no longer imports pipeline.env, which used to do this in Python.
if [ -z "${DATABASE_URL:-}" ]; then
    if ! db_assemble_url; then
        exit 1
    fi
fi

# Force UTF-8 IO so migration print lines (some contain ↔, ✓, etc.)
# don't blow up on Windows GBK consoles.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

# Resolve the Python interpreter: PREFER the backend .venv (it carries
# psycopg2 + sqlalchemy and understands the repo paths), fall back to a
# global python3/python on PATH (container / CMS host where there is no
# venv). NOTE: we must prefer the venv — a bare `python3` on a dev host
# (e.g. a managed/launcher python) may not resolve Git-Bash `/d/...`
# paths in PYTHONPATH and would fail with "No module named 'migrations'".
PYTHON_BIN=""
if [ -x "$PROJECT_DIR/backend/.venv/Scripts/python.exe" ]; then
    PYTHON_BIN="$PROJECT_DIR/backend/.venv/Scripts/python.exe"
elif [ -x "$PROJECT_DIR/backend/.venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_DIR/backend/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
fi
if [ -z "$PYTHON_BIN" ]; then
    echo "ERROR: 找不到 python3 / python,且 backend/.venv 不存在 — migrations.runner 需要它" >&2
    exit 1
fi
# Run from backend/ so the `migrations` package resolves regardless of how
# the interpreter handles PYTHONPATH path styles (a native Windows python
# does not understand Git-Bash `/d/...` paths). `-m migrations.runner` is
# equivalent to `from migrations.runner import main; main()`.
( cd "$PROJECT_DIR/backend" && "$PYTHON_BIN" -m migrations.runner "$@" )