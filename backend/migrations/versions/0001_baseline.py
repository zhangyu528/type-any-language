"""
0001_baseline — capture the schema as of the Phase 1 / pre-Phase-2 state.
"""
from __future__ import annotations

version = "0001_baseline"
description = "Baseline: capture the 3 content tables as declared by SQLAlchemy models"

import os
import sys
from pathlib import Path


def _ensure_backend_on_path() -> None:
    """backend/app/models/*.py must be importable. The CMS host's
    PYTHONPATH is `cms/tools/` (not `backend/`); add backend/ once.
    """
    backend_path = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "backend"
    backend_path_str = str(backend_path)
    if backend_path_str not in sys.path:
        sys.path.insert(0, backend_path_str)


def upgrade(conn) -> None:
    """Apply the baseline schema. CREATE TABLE IF NOT EXISTS semantics.

    This migration is the starting point for all future schema changes.
    It captures the schema as defined by the SQLAlchemy models at the
    end of Phase 1: the 3 content tables (vocabulary_libs,
    vocabulary_words, sentences) with all their columns including the
    ones Phase 2 will later drop (is_cached, is_stale, refresh_count)
    and missing the ones Phase 2 will add (vocabulary_words metadata,
    sentences metadata, sentence_word_links).

    For fresh DBs this creates the tables. For DBs that already have
    them (i.e. were bootstrapped by the legacy `init_schema.py
    create_all()` path before migrations existed) it's a no-op because
    SQLAlchemy's create_all() emits `CREATE TABLE IF NOT EXISTS`.
    """
    _ensure_backend_on_path()

    # Import inside the function so the migration doesn't fail at
    # collection time on machines that don't have backend/ on PYTHONPATH
    # (e.g. CI / lint / partial checkouts).
    from sqlalchemy import create_engine  # noqa: E402

    from app.database import Base  # noqa: E402
    # Importing the model modules registers them on Base.metadata.
    from app.models import vocabulary, sentence  # noqa: E402,F401

    # Read DATABASE_URL directly — db/scripts/migrate.sh assembles it
    # before invoking the runner (no longer via pipeline.env).
    # This migration is called with a psycopg2 conn (from the runner),
    # but the schema metadata is created via SQLAlchemy's create_all()
    # which needs its own engine. Both end up talking to the same DB.
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        sys.exit(
            "DATABASE_URL is not set. db/scripts/migrate.sh should have "
            "assembled it from POSTGRES_PASSWORD + code defaults before "
            "invoking this migration."
        )

    engine = create_engine(database_url)
    try:
        # create_all() is idempotent: it emits `CREATE TABLE IF NOT EXISTS`
        # (via SQLAlchemy's checkfirst=True default). Existing DBs no-op,
        # fresh DBs get the 3 tables.
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()


def downgrade(conn) -> None:
    """Drop everything baseline created. Cascading because of the FKs.

    Destructive — wipes all data. Used by `downgrade_one()` for full
    rollback to pre-migration state.
    """
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS sentences CASCADE")
        cur.execute("DROP TABLE IF EXISTS vocabulary_words CASCADE")
        cur.execute("DROP TABLE IF EXISTS vocabulary_libs CASCADE")
        cur.execute("DROP TABLE IF EXISTS schema_migrations")