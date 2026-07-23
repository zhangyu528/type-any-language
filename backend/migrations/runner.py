"""
backend/migrations/runner.py — minimal migration runner.

Why not Alembic: Alembic is a great tool for projects with many migrations
and large teams. For this project the migration count is small (currently
3-5 versions over the life of the app) and the dependency footprint
matters — Alembic pulls in Mako + its own template layer for what is, at
heart, just an ordered list of `upgrade()` SQL calls.

This module is a 60-line replacement: discover migration files in
`versions/`, sort by version id, apply any whose version is greater than
the one recorded in `schema_migrations.version`, and stamp the table on
success.

Each migration is a Python module under `versions/` exposing:

    version = "0001_baseline"
    description = "Create the 3 content tables"

    def upgrade(conn):
        conn.execute("CREATE TABLE ...")

    def downgrade(conn):
        conn.execute("DROP TABLE ...")

`conn` is a psycopg2 connection. SQL is raw — no Alembic-style op table,
no autogenerate. Migrations are hand-written; the surface is small enough.

Public API:
    upgrade_head(conn, target_version=None) -> list[str]
        Apply pending migrations in order, up to (and including)
        `target_version` (or all of them if None). Returns the list of
        versions applied in this run.

    get_current_version(conn) -> str | None
        The highest version recorded in schema_migrations, or None if no
        migrations have been applied yet.

    ensure_schema_migrations_table(conn) -> None
        Create the bookkeeping table if missing. Idempotent.

Invoked by:
  - db/scripts/migrate.sh  — any host with DATABASE_URL (typically the
                             CMS host, runs migrations against the cloud db)
  - ops/dev/migrate.sh     — dev target host, host-side runner that
                             sources db/scripts/lib.sh::resolve_dev_db_url
                             and re-execs db/scripts/migrate.sh

Both callers set PYTHONPATH=/backend and run `python -m migrations.runner`.
"""
from __future__ import annotations

import importlib
import inspect
import pkgutil
import sys
from pathlib import Path
from typing import Callable, Optional

import psycopg2
import psycopg2.extensions


VERSIONS_PACKAGE = "migrations.versions"
_BOOKKEEPING_TABLE = "schema_migrations"


# ---------------------------------------------------------------------------
# Version discovery + load
# ---------------------------------------------------------------------------
class Migration:
    """One loaded migration module."""

    __slots__ = ("version", "description", "upgrade", "downgrade", "module")

    def __init__(self, module) -> None:
        self.module = module
        self.version = getattr(module, "version", None)
        self.description = getattr(module, "description", "")
        self.upgrade: Callable[[psycopg2.extensions.connection], None] = getattr(
            module, "upgrade", None
        )
        self.downgrade: Callable[[psycopg2.extensions.connection], None] = getattr(
            module, "downgrade", None
        )
        if not self.version or not callable(self.upgrade):
            raise ValueError(
                f"migration {module.__name__!r} missing 'version' or 'upgrade(conn)'"
            )

    def __repr__(self) -> str:
        return f"<Migration {self.version}: {self.description}>"


def _discover_versions() -> list[Migration]:
    """Import every module under `versions/` and return them sorted by id."""
    pkg = importlib.import_module(VERSIONS_PACKAGE)
    versions: list[Migration] = []
    for mod_info in pkgutil.iter_modules(pkg.__path__):
        if mod_info.name.startswith("_"):
            continue
        full_name = f"{VERSIONS_PACKAGE}.{mod_info.name}"
        if full_name in sys.modules:
            module = sys.modules[full_name]
        else:
            module = importlib.import_module(full_name)
        versions.append(Migration(module))
    versions.sort(key=lambda m: m.version)
    return versions


def _module_path_for_diagnostics(m: Migration) -> str:
    """Path to the migration's source file — for error messages."""
    try:
        return inspect.getsourcefile(m.module) or m.module.__name__
    except TypeError:
        return m.module.__name__


# ---------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------
def ensure_schema_migrations_table(conn) -> None:
    """Create the bookkeeping table if it doesn't already exist.

    Idempotent — safe to call on every upgrade_head().
    """
    with conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {_BOOKKEEPING_TABLE} (
                version    TEXT PRIMARY KEY,
                applied_at TIMESTAMP NOT NULL DEFAULT now()
            )
            """
        )
    conn.commit()


def get_current_version(conn) -> Optional[str]:
    """Highest version recorded in schema_migrations, or None if empty."""
    ensure_schema_migrations_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT version FROM {_BOOKKEEPING_TABLE} ORDER BY version DESC LIMIT 1"
        )
        row = cur.fetchone()
    return row[0] if row else None


def _record_version(conn, version: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {_BOOKKEEPING_TABLE} (version) VALUES (%s)",
            (version,),
        )


def _delete_version(conn, version: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {_BOOKKEEPING_TABLE} WHERE version = %s",
            (version,),
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def upgrade_head(
    conn, target_version: Optional[str] = None
) -> list[str]:
    """Apply pending migrations in order.

    Args:
        conn: psycopg2 connection.
        target_version: if set, stop after applying this version (inclusive).
            Useful for partial upgrades / dev iteration.

    Returns:
        List of versions that were applied during this call (in order).
        Empty list if everything was already up to date.
    """
    ensure_schema_migrations_table(conn)
    current = get_current_version(conn)
    pending = _discover_versions()

    applied: list[str] = []
    for m in pending:
        if current is not None and m.version <= current:
            continue
        if target_version and m.version > target_version:
            break
        print(f"[migrations] applying {m.version}: {m.description}")
        try:
            m.upgrade(conn)
        except Exception as exc:
            conn.rollback()
            raise RuntimeError(
                f"migration {m.version} ({_module_path_for_diagnostics(m)}) failed: {exc}"
            ) from exc
        _record_version(conn, m.version)
        conn.commit()
        applied.append(m.version)
    return applied


def downgrade_one(conn) -> Optional[str]:
    """Roll back the most recently applied migration.

    Returns the version that was rolled back, or None if nothing to do.
    """
    ensure_schema_migrations_table(conn)
    current = get_current_version(conn)
    if current is None:
        return None

    # Find the migration whose version == current.
    target = next((m for m in _discover_versions() if m.version == current), None)
    if target is None or not callable(target.downgrade):
        raise RuntimeError(
            f"cannot downgrade: version {current!r} has no downgrade() "
            f"in the versions/ package"
        )

    print(f"[migrations] reverting {target.version}: {target.description}")
    try:
        target.downgrade(conn)
    except Exception as exc:
        conn.rollback()
        raise RuntimeError(
            f"downgrade of {target.version} failed: {exc}"
        ) from exc
    _delete_version(conn, target.version)
    conn.commit()
    return target.version


# ---------------------------------------------------------------------------
# CLI — quick sanity check + run.
# ---------------------------------------------------------------------------
def main() -> None:
    import argparse
    import os
    import sys

    parser = argparse.ArgumentParser(description="Apply pending schema migrations.")
    parser.add_argument(
        "--target", default=None,
        help="Stop after this version (inclusive). Default: apply all pending.",
    )
    parser.add_argument(
        "--downgrade", action="store_true",
        help="Roll back the most recent migration instead of upgrading.",
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Print current version + pending list, no changes.",
    )
    args = parser.parse_args()

    # DATABASE_URL is assembled by the calling db-side script
    # (db/scripts/migrate.sh / build.sh) from POSTGRES_PASSWORD + code
    # defaults. pipeline.env no longer touches it.
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        sys.exit(
            "DATABASE_URL is not set. db/scripts/migrate.sh (or build.sh) "
            "should have assembled it from POSTGRES_PASSWORD + code defaults "
            "before invoking this runner. Either run via migrate.sh, or "
            "export DATABASE_URL=postgresql://user:pwd@host:port/db."
        )

    with psycopg2.connect(database_url) as conn:
        ensure_schema_migrations_table(conn)
        current = get_current_version(conn)
        pending = _discover_versions()
        pending_after = [m for m in pending if current is None or m.version > current]

        if args.status:
            print(f"[migrations] current version: {current or '(none)'}")
            print(f"[migrations] {len(pending)} known versions, {len(pending_after)} pending:")
            for m in pending:
                marker = "  " if (current is None or m.version > current) else "ok"
                print(f"  [{marker}] {m.version}  {m.description}")
            return

        if args.downgrade:
            rolled = downgrade_one(conn)
            if rolled:
                print(f"[migrations] rolled back {rolled}")
            else:
                print("[migrations] nothing to roll back")
            return

        applied = upgrade_head(conn, target_version=args.target)
        if applied:
            print(f"[migrations] applied {len(applied)} version(s): {', '.join(applied)}")
        else:
            print(f"[migrations] already at version {current or '(none)'} — nothing to do")


if __name__ == "__main__":
    main()