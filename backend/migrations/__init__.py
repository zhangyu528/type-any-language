"""backend.migrations — schema migration runner + version files.

Public surface:
    from migrations import upgrade_head, get_current_version

    with psycopg2.connect(cfg.database_url) as conn:
        upgrade_head(conn)            # apply pending migrations
        print(get_current_version(conn))

Each migration is a Python module in `versions/` exposing:
    version = "0001_baseline"
    description = "..."
    def upgrade(conn): ...
    def downgrade(conn): ...    # optional — None disables downgrade

See `runner.py` for the loader / applier logic.
"""

from migrations.runner import (
    upgrade_head,
    downgrade_one,
    get_current_version,
    ensure_schema_migrations_table,
)

__all__ = [
    "upgrade_head",
    "downgrade_one",
    "get_current_version",
    "ensure_schema_migrations_table",
]