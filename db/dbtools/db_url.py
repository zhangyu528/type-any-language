"""
db/dbtools/db_url.py — minimal env-loader for db-only modules.

Lives next to init_schema.py + migrations/ because the schema code
needs DATABASE_URL but should NOT depend on the data-pipeline's
full Config object (cms/cms_pipeline/env.py loads TENCENT_*, AI_*,
AUDIO_DIR — none of which are db concerns).

This module assembles DATABASE_URL using only db-relevant variables
(POSTGRES_USER, POSTGRES_DB, POSTGRES_HOST, POSTGRES_PORT,
POSTGRES_PASSWORD). It does NOT call any external dependencies
(no psycopg2, no openai, no tencentcloud SDKs) and it does NOT
read any local file — secrets are resolved through the process
environment, typically:

  - cloud-db path:  ops/{dev,prod}/setup.sh bootstrap writes
                    .secrets/database_url; the calling shell exports
                    DATABASE_URL via resolve_dev_db_url / resolve_prod_db_url
                    (db/scripts/lib.sh) before Python starts.

  - self-hosted / CI:  operator runs
                    `eval "$(scripts/secrets/fetch_secrets.sh eval-db)"`
                    to inject DATABASE_URL from GitHub Secrets.

The legacy fallback to .secrets/postgres_password is retained so
direct invocations of `PYTHONPATH=db python3 -m dbtools.importer` (or
init_schema / migrations.runner) still work without bootstrap — useful
for ad-hoc CLI use where the operator composes POSTGRES_* env vars
by hand.

Mirrors the URL assembly in db/scripts/migrate.sh /
db/scripts/import_staging.sh (via ops/lib.sh's db_assemble_url helper)
so all db-side code agrees on what DATABASE_URL means.
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
    This file lives at db/dbtools/db_url.py → 3 hops up
    (dbtools/ → db/ → project_root) gives the project
    root.
    """
    return Path(__file__).resolve().parent.parent.parent


def resolve_database_url() -> str:
    """Return the full DATABASE_URL, either from env or assembled from parts.

    Priority: explicit DATABASE_URL env var > assembled from code defaults
    + POSTGRES_PASSWORD (from the process env or .secrets/postgres_password).

    Callers should ensure POSTGRES_PASSWORD / DATABASE_URL are in the
    process environment before invoking this function — typically by
    running
        eval "$(scripts/secrets/fetch_secrets.sh eval-db)"
    first, or by relying on db_assemble_url (from the db-side shell
    scripts) which writes .secrets/postgres_password on first start.
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
            "POSTGRES_PASSWORD is empty. Set POSTGRES_PASSWORD in the shell, "
            "or provide .secrets/postgres_password."
        )

    return f"postgresql://{quote(user, safe='')}:{quote(pw, safe='')}@{host}:{port}/{db}"