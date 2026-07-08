#!/usr/bin/env python3
"""
init_schema.py — schema bootstrap for the CMS host's DB.

Two-track bootstrap:

1. Migration runner (PRIMARY) — calls `pipeline.migrations.upgrade_head(conn)`
   which discovers every module under `pipeline.migrations.versions/` and
   applies any whose version is greater than the one recorded in
   `schema_migrations`. This is the supported path for both fresh DBs
   (all migrations apply) and existing DBs (already-applied versions are
   skipped automatically).

2. SQLAlchemy create_all() (SAFETY NET) — runs after the migration runner.
   Idempotent `CREATE TABLE IF NOT EXISTS`; covers the case where the
   backend was upgraded between an alembic-equivalent version and the
   SQLAlchemy model definitions diverged. Doesn't alter existing tables.

Why both: the migration runner is the source of truth (it knows about
ordering, bookkeeping, and schema evolution). create_all() guarantees the
DB at least has every table the SQLAlchemy models know about — useful
in dev when iterating on models before writing the corresponding
migration.

Why no Alembic dependency: Alembic requires Mako + a generated config
tree + its own template language for what is, at heart, a small ordered
list of `upgrade(conn)` calls. This project's migration count is small
(3-5 versions total over the life of the app) and a 60-line runner is
easier to read, audit, and modify than a generated Alembic env.py.

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
    from pipeline.env import setup_env, load_config  # noqa: E402
else:
    from .env import setup_env, load_config  # noqa: E402


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
    # 1. Load .env.db + assemble DATABASE_URL.
    setup_env()
    cfg = load_config()

    # 2. Make backend/app importable so the models + database engine resolve.
    _ensure_backend_on_path()

    # 3. Import models so SQLAlchemy metadata is populated for the safety
    #    net step below. (The migration runner doesn't need models — it
    #    applies raw SQL — but importing them here means a typo in a
    #    model file fails fast at init-schema time, not at first query.)
    from app.database import Base, engine  # noqa: E402
    from app.models import vocabulary, sentence  # noqa: E402,F401

    if not Base.metadata.tables:
        print("[ERR] Base.metadata is empty — model imports did not register anything", file=sys.stderr)
        print("      check that backend/app/models/__init__.py exposes the models", file=sys.stderr)
        return 1

    print(f"[INFO] DATABASE_URL = {engine.url.render_as_string(hide_password=True)}")
    print(f"[INFO] SQLAlchemy tables declared: {sorted(Base.metadata.tables.keys())}")

    # 4. PRIMARY: run the migration runner. This handles ordering, the
    #    schema_migrations bookkeeping table, and idempotent re-runs.
    import psycopg2  # noqa: E402
    from pipeline.migrations import upgrade_head, get_current_version  # noqa: E402

    with psycopg2.connect(cfg.database_url) as conn:
        before = get_current_version(conn)
        applied = upgrade_head(conn)
        after = get_current_version(conn)

    if applied:
        print(f"[OK]   Applied migrations: {', '.join(applied)}")
        print(f"[OK]   Schema version: {before or '(none)'} -> {after}")
    else:
        print(f"[OK]   Schema already at version: {after or '(none)'} (nothing pending)")

    # 5. SAFETY NET: SQLAlchemy create_all() against the same DB. Covers
    #    tables the migrations forgot or models added after a migration
    #    was written. Idempotent, no-op when already in sync.
    print()
    print("[INFO] Running SQLAlchemy create_all() as safety net...")
    Base.metadata.create_all(bind=engine)

    # 6. Verify by introspecting the DB.
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