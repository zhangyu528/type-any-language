#!/usr/bin/env python3
"""backend/scripts/preflight.py

Read-only self-check for the backend dev loop. Exits 0 if all checks
pass, 1 if any fail.

Replaces the inline backend checks that used to live in
ops/dev/doctor.sh and ops/dev/native.sh::cmd_preflight.

Why backend-owned (vs inline in ops/):
  - backend knows its own contract: what Python version it needs,
    what scripts/ should look like, what critical .py files must
    exist. Ops shouldn't hardcode these.
  - Same shape as frontend's npm run preflight — a single source
    of truth per segment.

Checks (7):
  1. python ≥ 3.11
  2. requirements.txt present
  3. .venv/ present
  4. venv python (Scripts/python.exe or bin/python) present
  5. uvicorn installed in venv (Scripts/uvicorn.exe or bin/uvicorn)
  6. critical backend files present (app/main.py, migrations/runner.py,
     init_schema.py, Dockerfile)
  7. scripts/ self-consistency (install.py, dev.py, preflight.py)

Usage:
  make preflight           # from backend/
  python3 scripts/preflight.py
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
VENV_DIR = BACKEND_DIR / ".venv"
REQ_FILE = BACKEND_DIR / "requirements.txt"
HASH_FILE = BACKEND_DIR / ".requirements.sha256"

failed = 0


def ok(msg: str) -> None:
    print(f"[preflight][ok] {msg}")


def warn(msg: str) -> None:
    print(f"[preflight][warn] {msg}")


def err(msg: str) -> None:
    print(f"[preflight][err] {msg}")


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def venv_uvicorn() -> Path:
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "uvicorn.exe"
    return VENV_DIR / "bin" / "uvicorn"


# ─── 1. python ≥ 3.11 ───────────────────────────────────────────────────
v = sys.version_info
if (v.major, v.minor) >= (3, 11):
    ok(f"python {v.major}.{v.minor}")
else:
    err(f"python {v.major}.{v.minor} (need ≥ 3.11)")
    failed += 1

# ─── 2. requirements.txt present ─────────────────────────────────────────
if REQ_FILE.exists():
    ok("requirements.txt present")
else:
    err(f"requirements.txt missing at {REQ_FILE}")
    failed += 1

# ─── 3. .venv present ────────────────────────────────────────────────────
if VENV_DIR.exists():
    ok("backend/.venv present")
else:
    err("backend/.venv missing — run: make install")
    failed += 1

# ─── 4. venv python present ─────────────────────────────────────────────
vp = venv_python()
if vp.exists():
    ok(f"{vp.relative_to(BACKEND_DIR)} present")
else:
    err(f"{vp} missing — re-run make install")
    failed += 1

# ─── 5. uvicorn installed in venv ───────────────────────────────────────
uv = venv_uvicorn()
if uv.exists():
    ok("uvicorn installed in venv")
else:
    err("uvicorn not in venv — run: make install")
    failed += 1

# ─── 6. critical backend files present ──────────────────────────────────
for rel in ["app/main.py", "migrations/runner.py", "init_schema.py", "Dockerfile"]:
    p = BACKEND_DIR / rel
    if p.exists():
        ok(f"{rel} present")
    else:
        err(f"{rel} missing")
        failed += 1

# ─── 7. scripts/ self-consistency ───────────────────────────────────────
for name in ["install.py", "dev.py", "preflight.py"]:
    p = BACKEND_DIR / "scripts" / name
    if p.exists():
        ok(f"scripts/{name} present")
    else:
        err(f"scripts/{name} missing")
        failed += 1

# ─── bonus: lock hash sanity (read-only, mirrors install.py) ─────────────
if REQ_FILE.exists() and HASH_FILE.exists() and vp.exists():
    cur = hashlib.sha256(REQ_FILE.read_bytes()).hexdigest()
    stored = HASH_FILE.read_text().strip()
    if cur == stored:
        ok("requirements.txt hash match (venv assumed healthy)")
    else:
        warn("requirements.txt hash mismatch — run: make install")

# ─── summary ────────────────────────────────────────────────────────────
print()
if failed == 0:
    ok("all preflight checks passed")
    sys.exit(0)
else:
    err(f"{failed} preflight check(s) failed")
    sys.exit(1)
