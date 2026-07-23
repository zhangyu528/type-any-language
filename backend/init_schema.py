#!/usr/bin/env python3
"""
init_schema.py — schema bootstrap for the dev / prod docker postgres.

Two-track bootstrap:

1. Migration runner (PRIMARY) — calls `migrations.upgrade_head(conn)`
   which discovers every module under `migrations.versions/` and
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

Why this lives at backend/init_schema.py and not db/init_schema.py:
   Migrations and schema bootstrap are tightly coupled to the SQLAlchemy
   ORM models in backend/app/models/. Co-locating all schema code under
   backend/ keeps the "model + migration + bootstrap" trio together. db/
   now only holds importer (CMS staging → docker postgres UPSERT) and bootstrap
   shell scripts (ROLE/DB/GRANT, DSN file writing). See CLAUDE.md
   "Repository structure" for the rationale.

Env handling — minimal:
  This module resolves DATABASE_URL via db_url (a 60-line helper
  in db/db_url.py, kept for self-hosted / CI / ad-hoc CLI use).
  The shell-side entry points (`db/scripts/lib.sh::resolve_*_db_url`)
  export DATABASE_URL via `DATABASE_URL` (written once per host
  by `bootstrap_tencent.sh`) before Python starts — the python fallback
  chain never runs in the normal flow.

Usage
-----
    # From project root, with PYTHONPATH containing both backend and db:
    PYTHONPATH=backend:db python3 -m init_schema           # via the package name
    PYTHONPATH=backend:db python3 backend/init_schema.py   # direct invocation
    ./db/scripts/init_schema.sh              # wrapper (sets PYTHONPATH for you)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _resolve_database_url():
    """Resolve DATABASE_URL with the canonical cloud path preferred.

    Order: explicit env DATABASE_URL > db_url.resolve_database_url().
    db_url lives directly at db/db_url.py (was previously at db/dbtools/
    db_url.py — the dbtools package was flattened in the same refactor that
    moved init_schema + migrations to backend/). The caller is expected to have
    `db` on PYTHONPATH (db/scripts/init_schema.sh sets it for the operator).
    """
    explicit = os.environ.get("DATABASE_URL", "").strip()
    if explicit:
        return explicit
    from db_url import resolve_database_url  # noqa: E402
    return resolve_database_url()


def _ensure_app_on_path() -> None:
    """Make backend/app/ importable so app.database + app.models resolve.

    This file lives at backend/init_schema.py — when run as a module via
    `python -m init_schema`, the cwd is project_root and backend/ may not
    be on sys.path. Add it once.
    """
    if "" not in sys.path and "." not in sys.path:
        # Add the directory containing `init_schema.py` so `app.*` imports
        # resolve (app/ lives next to init_schema.py inside backend/).
        backend_path = str(Path(__file__).resolve().parent)
        if backend_path not in sys.path:
            sys.path.insert(0, backend_path)


def main() -> int:
    # 1. DATABASE_URL from process env (typically supplied by db/scripts/
    #    lib.sh::resolve_*_db_url on the docker postgres path).
    database_url = _resolve_database_url()

    # 2. Make backend/app importable so models + engine resolve.
    _ensure_app_on_path()

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
    from migrations import upgrade_head, get_current_version  # noqa: E402

    with psycopg2.connect(database_url) as conn:
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