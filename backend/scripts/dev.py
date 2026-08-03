#!/usr/bin/env python3
"""backend/scripts/dev.py

Self-healing entry point for backend dev. Replaces the bare
`uvicorn app.main:app --reload ...` in ops/dev/native.sh.

What it does:
  1. Run `make install` (delegates to scripts/install.py — hash-aware
     pip install, ~50ms when venv + lock hash are healthy).
  2. os.execvp the venv python with `uvicorn app.main:app --reload
     --host 0.0.0.0 --port $PORT` + any argv pass-through. execvp
     REPLACES the current process — uvicorn becomes the foreground
     process, inheriting the terminal. SIGINT (Ctrl+C) propagates
     naturally without any forwarder logic (a Node .mjs equivalent
     would need a SIGINT handler that re-kills the child).

Why this is dev.py, not raw uvicorn in package.json-equivalent:
  - Same shape as frontend dev.mjs: dependency health is guaranteed
    before the real service starts.
  - install.py stays single-purpose (just install). dev.py is the
    thin orchestrator.

Scope vs install.py / preflight.py:
  - make install     → smart pip install (install.py)
  - make dev         → install + start uvicorn (this script)
  - make preflight   → read-only backend self-check (preflight.py)

Usage:
  make dev                      # default PORT=8000
  PORT=9000 make dev            # custom port
  python3 scripts/dev.py --port 9001   # argv pass-through to uvicorn
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def venv_python() -> Path:
    if sys.platform == "win32":
        return BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    return BACKEND_DIR / ".venv" / "bin" / "python"


def main() -> None:
    # ─── 1. self-heal: ensure venv is healthy ────────────────────────────
    print("[dev] ensuring venv is healthy (smart install)...")
    # `make install` resolves to `python3 scripts/install.py` per backend/Makefile.
    # Use the host python3 (not venv) since install.py may need to create the venv.
    subprocess.check_call(
        ["make", "install"],
        cwd=str(BACKEND_DIR),
    )

    # ─── 2. execvp uvicorn (replaces this process; SIGINT inherited) ──────
    py = venv_python()
    if not py.exists():
        print(f"[dev] [ERR] venv python missing at {py} — run: make install", file=sys.stderr)
        sys.exit(1)
    port = os.environ.get("PORT", "8000")
    # argv pass-through: operator args after dev.py go to uvicorn.
    # `make dev -- --port 9001` → make strips the first --, leaving
    # ['--port', '9001'] in sys.argv (positions 1+).
    args = [str(py), "-m", "uvicorn", "app.main:app",
            "--reload", "--host", "0.0.0.0", "--port", port,
            *sys.argv[1:]]
    print(f"[dev] execvp uvicorn on :{port}")
    os.execvp(args[0], args)
    # unreachable: execvp replaces the process on success


if __name__ == "__main__":
    main()
