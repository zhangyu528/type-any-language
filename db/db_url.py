"""
db/db_url.py — minimal env-loader for db-only modules.

Lives directly under db/ (was previously in the deprecated db/dbtools/
package, now flattened). Coexists with db/importer.py and db/scripts/* as
db-side modules that have no dependency on the web framework or data-
pipeline.

The runtime database is a `postgres:15-alpine` container managed by
docker compose (see docker-compose.yml / docker-compose.dev.yml).
Containers receive DATABASE_URL via compose's `environment:` block,
so the host-side shell scripts that invoke Python (migrate.sh,
import_staging.sh) need only one thing: assemble DATABASE_URL when
the operator runs them on the host shell (not inside the container).

Resolution chain (priority order):
  1. $DATABASE_URL already in env — returned as-is
  2. Assembled from POSTGRES_USER / POSTGRES_DB / POSTGRES_HOST /
     POSTGRES_PORT / POSTGRES_PASSWORD — falls back to .secrets/
     postgres_password as a last-resort defensive fallback (rare;
     typical callers all use case 1 above)

This module is consumed by db/scripts/{migrate,init_schema,
import_staging}.sh via `db_assemble_url()` in db/scripts/lib.sh,
and by backend/init_schema.py as `db_url.resolve_database_url()`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote

# Code defaults — match db/scripts/lib.sh so any caller produces the
# same DATABASE_URL for the same env.
_DEFAULT_POSTGRES_USER = "english_user"
_DEFAULT_POSTGRES_DB = "english_learning"
_DEFAULT_POSTGRES_HOST = "localhost"
_DEFAULT_POSTGRES_PORT = "5432"

# Where .secrets/postgres_password lives if it exists. This was the
# legacy storage for db bootstrap-generated passwords (pre-docker-db
# era). The new docker-compose path doesn't write it — passwords come
# from compose env. We still fall back to reading it for self-hosted /
# ad-hoc CLI use where the operator manually created one.
_SECRETS_DIR_NAME = ".secrets"


def find_project_root() -> Path:
    """Project root = parent of this file's parent.
    This file lives at db/db_url.py → 2 hops up
    (db_url.py → db/ → project root).
    """
    return Path(__file__).resolve().parent.parent


def resolve_database_url() -> str:
    """Return the full DATABASE_URL, either from env or assembled from parts.

    Priority: explicit DATABASE_URL env var > assembled from code defaults
    + POSTGRES_PASSWORD (from env or .secrets/postgres_password).

    Exit 1 if no DSN can be assembled.

    The cloud-db era required an admin-DSN detour through
    bootstrap_tencent.sh — that's gone. Now compose sets DATABASE_URL on
    the backend service directly, and the host-side shell scripts just
    need the env to be exported (or, as a defensive fallback, the
    POSTGRES_* vars to be present).
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
        # Last resort: try .secrets/postgres_password (legacy cloud-db
        # storage, kept as a defensive fallback for self-hosted /
        # ad-hoc CLI use).
        secrets = find_project_root() / _SECRETS_DIR_NAME / "postgres_password"
        if secrets.is_file():
            pw = secrets.read_text(encoding="utf-8").strip()
    if not pw:
        sys.exit(
            "DATABASE_URL/POSTGRES_PASSWORD is empty. Set DATABASE_URL in the "
            "shell, or compose injects it from environment:. For ad-hoc CLI use, "
            "either export POSTGRES_PASSWORD or create .secrets/postgres_password."
        )

    return f"postgresql://{quote(user, safe='')}:{quote(pw, safe='')}@{host}:{port}/{db}"
