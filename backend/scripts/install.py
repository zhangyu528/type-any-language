#!/usr/bin/env python3
"""backend/scripts/install.py

Smart pip install. Replaces ops/dev/setup.sh::native_setup_python.

Idempotent:
  1. If .venv/ missing → create via `python3 -m venv .venv`
  2. Compute sha256(requirements.txt); compare against
     .requirements.sha256. Match + venv healthy → skip.
  3. Mismatch → run .venv/{Scripts,bin}/python -m pip install -r
     requirements.txt, write new hash.

Why Python (not Node .mjs):
  - backend is a Python project. Driving pip/uvicorn from Node via
    execFileSync is awkward; Python's subprocess is the native match.
  - hashlib (stdlib) replaces sh's sha256sum/awk/tr dance.
  - venv path resolution uses sys.platform + os.sep — no fs.existsSync
    probe of "Scripts vs bin" needed.

Usage:
  make install           # from backend/
  python3 scripts/install.py
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
VENV_DIR = BACKEND_DIR / ".venv"
REQ_FILE = BACKEND_DIR / "requirements.txt"
HASH_FILE = BACKEND_DIR / ".requirements.sha256"


def venv_python() -> Path:
    """Cross-platform path to the venv's python binary."""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    if not REQ_FILE.exists():
        print(f"[install] [ERR] requirements.txt not found at {REQ_FILE}")
        return 1

    # Step 1: create venv if missing
    if not VENV_DIR.exists():
        print(f"[install] creating venv at {VENV_DIR}")
        subprocess.check_call(
            [sys.executable, "-m", "venv", str(VENV_DIR)],
            cwd=str(BACKEND_DIR),
        )
    else:
        print("[install] venv exists — skip create")

    # Step 2: hash check
    current_hash = sha256(REQ_FILE)
    prior_hash = HASH_FILE.read_text().strip() if HASH_FILE.exists() else ""
    venv_py = venv_python()
    if prior_hash == current_hash and venv_py.exists():
        print("[install] requirements.txt hash match + venv healthy — skip")
        return 0

    # Step 3: pip install
    if not venv_py.exists():
        print(f"[install] [ERR] venv python missing at {venv_py} — recreate venv")
        return 1
    print("[install] running pip install -r requirements.txt ...")
    subprocess.check_call(
        [str(venv_py), "-m", "pip", "install", "-r", str(REQ_FILE)],
        cwd=str(BACKEND_DIR),
    )
    HASH_FILE.write_text(current_hash + "\n")
    print(f"[install] installed; wrote {HASH_FILE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
