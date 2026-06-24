#!/usr/bin/env python3
"""
init_schema.py — first-time schema bootstrap for the CMS host's DB.

Why this script exists
----------------------
`backend/app/main.py` calls `Base.metadata.create_all(bind=engine)` as a
safety net, but the comment there says it's for tests, not the source
of truth. The CMS host doesn't run the backend — it only runs
`scripts/ops/db/content.sh {sync,sentences,audio,export}` and
`scripts/ops/db/bake_image.sh`. None of those create the 3 content
tables (vocabulary_libs / vocabulary_words / sentences). `import_vocab`
just INSERTs; pg_dump against an empty schema produces an empty dump.

So the gap is: a fresh CMS host has a running postgres with NO tables,
and no documented step to create them. This script fills that gap by
importing the SQLAlchemy models (the actual source of truth) and
running create_all() against the CMS host's DB.

Idempotent
----------
create_all() is `CREATE TABLE IF NOT EXISTS` semantically — safe to
re-run. If a table already exists with a different shape, this script
will NOT migrate it; it'll just skip. For schema changes, do a
`pg_dump --schema-only` of the new shape and apply manually.

Usage
-----
    python -m pipeline.init_schema                # from project root, PYTHONPATH=db
    PYTHONPATH=db python3 db/pipeline/init_schema.py
    ./scripts/ops/db/content.sh init-schema      # wrapper
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running this file directly (python init_schema.py) AND as
# `python -m pipeline.init_schema` from the project root. Mirrors the
# same bootstrap block in import_vocab.py / generate_sentences.py.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from pipeline.env import setup_env  # noqa: E402
else:
    from .env import setup_env  # noqa: E402


def _ensure_backend_on_path() -> None:
    """The schema definitions live in backend/app/models/*.py. We need
    them importable, but the CMS host's PYTHONPATH is `db/` (not
    `backend/`). Add backend/ once.
    """
    backend_path = Path(__file__).resolve().parent.parent.parent / "backend"
    backend_path_str = str(backend_path)
    if backend_path_str not in sys.path:
        sys.path.insert(0, backend_path_str)


def main() -> int:
    # 1. Load .env.db + assemble DATABASE_URL (sets os.environ["DATABASE_URL"]).
    setup_env()

    # 2. Make backend/app importable so the models + database engine resolve.
    _ensure_backend_on_path()

    # 3. Import order matters: import the database module FIRST (this
    #    reads DATABASE_URL from env via get_settings()), then the
    #    models so they register on Base.metadata. Importing the
    #    routers works too (they import the models transitively), but
    #    explicit model imports are clearer and don't drag in FastAPI.
    from app.database import Base, engine  # noqa: E402
    from app.models import vocabulary, sentence  # noqa: E402,F401

    # 4. Pre-flight: confirm the engine actually has a URL. get_settings()
    #    already raised if not, but a noop recheck here makes the failure
    #    mode obvious in logs.
    if not Base.metadata.tables:
        print("[ERR] Base.metadata is empty — model imports did not register anything", file=sys.stderr)
        print("      check that backend/app/models/__init__.py exposes the models", file=sys.stderr)
        return 1

    print(f"[INFO] DATABASE_URL = {engine.url.render_as_string(hide_password=True)}")
    print(f"[INFO] Tables to create: {sorted(Base.metadata.tables.keys())}")

    # 5. Create. create_all() is `CREATE TABLE IF NOT EXISTS` — safe to re-run.
    Base.metadata.create_all(bind=engine)

    # 6. Verify by introspecting the DB. We use the same engine so we
    #    don't need psycopg2 here (the import_vocab module brings it
    #    in, but init_schema should be runnable with just SQLAlchemy).
    from sqlalchemy import inspect  # noqa: E402
    inspector = inspect(engine)
    existing = sorted(inspector.get_table_names())
    print(f"[OK]   Tables now in DB: {existing}")
    missing = set(Base.metadata.tables) - set(existing)
    if missing:
        print(f"[ERR]  Tables still missing after create_all: {missing}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
