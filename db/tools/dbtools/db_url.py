"""
db/tools/dbtools/db_url.py — minimal env-loader for db-only modules.

Lives next to init_schema.py + migrations/ because the schema code
needs DATABASE_URL but should NOT depend on the data-pipeline's
full Config object (cms/cms_pipeline/env.py loads TENCENT_*, AI_*,
AUDIO_DIR — none of which are db concerns).

This module reads cms/.env and assembles DATABASE_URL using only
db-relevant variables (POSTGRES_USER, POSTGRES_DB, POSTGRES_HOST,
POSTGRES_PORT, POSTGRES_PASSWORD). It does NOT call any external
dependencies (no psycopg2, no openai, no tencentcloud SDKs).

Used by:
  - db/tools/dbtools/init_schema.py (primary)
  - db/tools/dbtools/migrations/runner.py (if it needs a connection too)

Mirrors the URL assembly in db/scripts/build.sh (via ops/lib.sh's
db_assemble_url helper) so all db-side code agrees on what DATABASE_URL
means.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote

# Code defaults — match db/scripts/build.sh and db/scripts/export_bundle.py
# so any of them produces the same DATABASE_URL for the same env.
_DEFAULT_POSTGRES_USER = "english_user"
_DEFAULT_POSTGRES_DB = "english_learning"
_DEFAULT_POSTGRES_HOST = "localhost"
_DEFAULT_POSTGRES_PORT = "5432"


def find_project_root() -> Path:
    """Project root = parent of this file's package's parent.
    This file lives at db/tools/dbtools/db_url.py → 4 hops up
    (dbtools/ → db/tools/ → db/ → project_root) gives the project
    root.
    """
    return Path(__file__).resolve().parent.parent.parent.parent


def _load_cms_env(env_path: Path) -> dict[str, str]:
    """Load cms/.env into a dict (no os.environ side effects).

    Mirrors lib.sh's `set -a; . ./cms/.env; set +a` semantics:
    - skip blank lines and lines starting with `#`
    - strip optional surrounding quotes
    - use `os.environ.setdefault` for anything the operator already
      exported in their shell (shell env wins over file)
    """
    out: dict[str, str] = {}
    if not env_path.is_file():
        sys.exit(
            f"cms/.env not found at {env_path} — run ./cms/scripts/env.sh init to scaffold"
        )
    with env_path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            # Don't clobber a shell-set value with the file's value.
            out.setdefault(key, value)
    return out


def resolve_database_url() -> str:
    """Return the full DATABASE_URL, either from env or assembled from parts.

    Priority: explicit DATABASE_URL env var > assembled from code defaults
    + POSTGRES_PASSWORD (sourced from cms/.env or shell).

    Caller is expected to have called load_cms_env() once at startup
    so cms/.env's keys are visible in os.environ; this function falls
    back to a fresh load if os.environ doesn't have what it needs
    (defensive — but the normal path is the upfront load).
    """
    explicit = os.environ.get("DATABASE_URL", "").strip()
    if explicit:
        return explicit

    user = os.environ.get("POSTGRES_USER", _DEFAULT_POSTGRES_USER)
    db = os.environ.get("POSTGRES_DB", _DEFAULT_POSTGRES_DB)
    host = os.environ.get("POSTGRES_HOST", _DEFAULT_POSTGRES_HOST)
    port = os.environ.get("POSTGRES_PORT", _DEFAULT_POSTGRES_PORT)

    pw = os.environ.get("POSTGRES_PASSWORD", "").strip()
    if not pw:
        # Last resort: try .secrets/postgres_password (same fallback
        # db/scripts/build.sh uses).
        secrets = find_project_root() / ".secrets" / "postgres_password"
        if secrets.is_file():
            pw = secrets.read_text(encoding="utf-8").strip()
    if not pw:
        sys.exit(
            "POSTGRES_PASSWORD is empty. Set it in cms/.env, copy "
            ".secrets/postgres_password from a dev/prod host, or "
            "export POSTGRES_PASSWORD=... in the shell."
        )

    return f"postgresql://{quote(user, safe='')}:{quote(pw, safe='')}@{host}:{port}/{db}"


def load_cms_env_into_os_environ() -> None:
    """Load cms/.env into os.environ (setdefault semantics)."""
    project_root = find_project_root()
    env_path = project_root / "cms" / ".env"
    loaded = _load_cms_env(env_path)
    for k, v in loaded.items():
        os.environ.setdefault(k, v)