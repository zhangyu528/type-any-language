#!/usr/bin/env python3
"""backend/scripts/dev.py

Self-healing entry point for backend dev. Replaces the bare
`uvicorn app.main:app --reload ...` in ops/dev
ative.sh.

What it does, in order:
  1. Ensure the docker db is up (sunk from dev/cli/run.js preflight —
     delegates to db/scripts/dev_db.sh, which owns docker stack check +
     compose up + wait-healthy).
  2. Run install.py (hash-aware pip install, ~50ms when venv + lock
     hash are healthy).
  3. Apply pending migrations (mirrors backend image entrypoint —
     `python -m migrations.runner`). Sunk from dev/cli/run.js.
  4. Smart-import cms/content/* if newer than the marker (sunk from
     dev/cli/run.js — calls db/scripts/import_staging.sh).
  5. os.execvp the venv python with `uvicorn app.main:app --reload
     --host 0.0.0.0 --port $PORT` + any argv pass-through.

execvp at step 5 REPLACES the current process — uvicorn becomes the
foreground process, inheriting the terminal. SIGINT (Ctrl+C) propagates
naturally without any forwarder logic.

Each preflight step is idempotent — a healthy state is ~50ms total.
First run after a fresh checkout is the only run that pays real cost.

Why this is dev.py, not raw uvicorn:
  - Same shape as frontend dev.mjs: dependency health + db health +
    schema health + content freshness are guaranteed before the real
    service starts. The dev host gets the same one-command UX as a
    container start: `dev run` → ready-to-serve backend.
  - install.py stays single-purpose (just install). dev.py is the
    thin orchestrator.

Scope vs install.py / preflight.py:
  - install.py     → smart pip install
  - dev.py (this)  → ensure-db + install + migrate + import + uvicorn
  - preflight.py   → read-only backend self-check

Flags (parsed before argv pass-through to uvicorn):
  --skip-import     Skip the smart-import step (e.g. when iterating
                    on backend code and you don't want re-import on
                    every restart). mtime-based — touching a content
                    file still triggers re-import on the next non-skip.
  --skip-migrate    Skip the migration step (use when you know the
                    DB is already at the right schema).

Usage:
  python3 scripts/dev.py                 # default PORT=8000
  PORT=9000 python3 scripts/dev.py       # custom port
  python3 scripts/dev.py --port 9001     # argv pass-through to uvicorn
  python3 scripts/dev.py --skip-import    # skip content import this run
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
DEV_DB_SH = PROJECT_DIR / "db" / "scripts" / "dev_db.sh"
IMPORT_SCRIPT = PROJECT_DIR / "db" / "scripts" / "import_staging.sh"
MARKER = PROJECT_DIR / "dev-cli" / ".local" / "import_marker"
CONTENT_DIRS = [
    PROJECT_DIR / "cms" / "content" / "vocabulary",
    PROJECT_DIR / "cms" / "content" / "sentences",
]

# Bash interpreter for shell-out to .sh scripts. The `dev` entry script
# exports DEV_BASH (Windows-style path to Git Bash) so we bypass PATH
# resolution — otherwise subprocess.run(["bash", ...]) on Windows
# picks up WSL's bash.exe shim and fails with
# "execvpe(/bin/bash) failed" when WSL bash isn't installed.
SUBPROC_BASH = os.environ.get("DEV_BASH", "bash")


def venv_python() -> Path:
    if sys.platform == "win32":
        return BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    return BACKEND_DIR / ".venv" / "bin" / "python"


def command_exists(name: str) -> bool:
    """Return True iff `name` is on PATH and executable.

    shutil.which handles Windows .exe / .bat / .cmd lookup correctly;
    `command -v` in subprocess is the bash-only equivalent.
    """
    return shutil.which(name) is not None


def ensure_dev_db_up() -> None:
    """Bring up the docker db service if it isn't running.

    Sunk from dev-cli/run.js preflight. Delegates to the db subsystem:
    `db/scripts/dev_db.sh` owns the docker stack check + compose up
    + wait-healthy dance.
    """
    if not command_exists(SUBPROC_BASH):
        print(f"[dev] [ERR] bash not found at {SUBPROC_BASH} — "
              "required to bring up the docker db", file=sys.stderr)
        sys.exit(1)
    r = subprocess.run([SUBPROC_BASH, str(DEV_DB_SH)], cwd=str(PROJECT_DIR))
    if r.returncode != 0:
        print(f"[dev] [ERR] dev db unavailable (exit {r.returncode}). "
              "Is Docker Desktop running?", file=sys.stderr)
        sys.exit(r.returncode)


def python_env() -> dict:
    """Env for spawning python subprocesses.

    PYTHONUTF8=1 forces UTF-8 for stdin/stdout/stderr on Windows (PEP 540).
    Without this, Python's default Windows encoding (GBK / cp936) can't
    print non-ASCII chars like the `↔` in migration descriptions, throwing
    UnicodeEncodeError.
    """
    return {**os.environ, "PYTHONUTF8": "1"}


def smart_import(python_bin: str) -> None:
    """Import cms/content/* if newer than the marker.

    Sunk from dev-cli/run.js preflight. mtime-based check — healthy
    state is 2-3 stat calls. When the marker is missing, treats it
    as epoch (first run → imports). The import itself is 5-30s.

    python_bin: absolute path to the venv python (sys.executable).
    Passed to import_staging.sh via PYTHON_BIN env var so its `python3`
    invocation resolves to a real python instead of going through PATH
    (where on Windows the Python launcher `py.exe` may fail with
    "No suitable Python runtime found").
    """
    if not IMPORT_SCRIPT.exists():
        print(f"[dev] [warn] import script missing at {IMPORT_SCRIPT} — skipping")
        return

    # Max mtime across cms/content/{vocabulary,sentences}/*.json|jsonl
    content_max = 0.0
    for d in CONTENT_DIRS:
        if not d.exists():
            continue
        for p in d.iterdir():
            if p.suffix not in (".json", ".jsonl"):
                continue
            try:
                m = p.stat().st_mtime
                if m > content_max:
                    content_max = m
            except OSError:
                pass  # race with delete; ignore

    if content_max == 0:
        print("[dev] no content files under cms/content/ — skipping import")
        return

    marker_mtime = MARKER.stat().st_mtime if MARKER.exists() else 0.0
    if content_max <= marker_mtime:
        print("[dev] content up-to-date — skipping import")
        return

    print("[dev] cms/content/ has updates — importing...")
    r = subprocess.run(
        [SUBPROC_BASH, str(IMPORT_SCRIPT), "all"],
        env={**python_env(), "PYTHON_BIN": python_bin},
    )
    if r.returncode != 0:
        print(f"[dev] [ERR] import failed (exit {r.returncode})", file=sys.stderr)
        sys.exit(r.returncode)

    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text("")  # touch — sets mtime to now
    print("[dev] import ok — marker updated")


def parse_self_flags(argv: list[str]) -> tuple[list[str], bool, bool]:
    """Split dev.py's own flags from those that should pass through to uvicorn.

    Returns (uvicorn_argv, skip_import, skip_migrate).
    """
    skip_import = False
    skip_migrate = False
    uvicorn_argv: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--skip-import":
            skip_import = True
        elif a == "--skip-migrate":
            skip_migrate = True
        else:
            uvicorn_argv.append(a)
        i += 1
    return uvicorn_argv, skip_import, skip_migrate


def main() -> None:
    uvicorn_argv, skip_import, skip_migrate = parse_self_flags(sys.argv[1:])

    # ─── 1. ensure docker db is up (sunk from dev/cli/run.js) ────────────
    print("[dev] ensuring docker db is up...")
    ensure_dev_db_up()

    # ─── 2. self-heal: ensure venv is healthy ────────────────────────────
    print("[dev] ensuring venv is healthy (smart install)...")
    # `make install` resolves to `python3 scripts/install.py` per backend/Makefile.
    # On Windows Git Bash there is no `make` in PATH — fall back to invoking
    # install.py directly with the host python3. install.py is idempotent
    # (venv healthy + lock hash match → no-op, ~50ms).
    if command_exists("make"):
        install_cmd = ["make", "install"]
        install_env = None
    else:
        install_cmd = [sys.executable, str(BACKEND_DIR / "scripts" / "install.py")]
        install_env = python_env()
    subprocess.check_call(install_cmd, cwd=str(BACKEND_DIR), env=install_env)

    # ─── 3. apply pending migrations (mirrors backend image entrypoint) ──
    py = venv_python()
    if not py.exists():
        print(f"[dev] [ERR] venv python missing at {py} — install step failed?",
              file=sys.stderr)
        sys.exit(1)
    if not skip_migrate:
        print("[dev] applying pending migrations (python -m migrations.runner)...")
        try:
            subprocess.check_call(
                [str(py), "-m", "migrations.runner"],
                cwd=str(BACKEND_DIR),
                env=python_env(),
            )
        except subprocess.CalledProcessError as exc:
            print(
                "[dev] [ERR] migrations failed (exit "
                f"{exc.returncode}). Fix the DB / schema, then retry.",
                file=sys.stderr,
            )
            sys.exit(exc.returncode)

    # ─── 4. smart-import content (sunk from dev-cli/run.js) ──────────────
    if not skip_import:
        smart_import(sys.executable)

    # ─── 5. execvp uvicorn (Unix: replaces this process; SIGINT inherited) ──
    # On Windows, os.execvp can't actually replace the process — it spawns
    # the new program with a new PID and exits the current one. That would
    # make dev-cli/run.js think the child exited (with code 0) and kill the
    # frontend sibling. Workaround: on Windows run uvicorn as a blocking
    # subprocess instead, so dev.py stays alive for the lifetime of uvicorn.
    port = os.environ.get("PORT", "8000")
    args = [str(py), "-m", "uvicorn", "app.main:app",
            "--reload", "--host", "0.0.0.0", "--port", port,
            *uvicorn_argv]
    if sys.platform == "win32":
        print(f"[dev] running uvicorn on :{port} (Windows: blocking subprocess)")
        # Don't capture stdout — inherit so dev-cli/run.js line-prefixes it.
        rc = subprocess.call(args, cwd=str(BACKEND_DIR))
        sys.exit(rc)
    print(f"[dev] execvp uvicorn on :{port}")
    os.execvp(args[0], args)
    # unreachable: execvp replaces the process on success


if __name__ == "__main__":
    main()
