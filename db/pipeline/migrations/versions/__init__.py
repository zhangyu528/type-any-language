"""Migrations live here. Add a new file per schema change.

Each module exposes:
    version = "000N_short_name"        # sort key, must be unique
    description = "Human-readable line"  # printed during apply
    def upgrade(conn): ...               # required
    def downgrade(conn): ...             # optional (omit to forbid downgrades)

`conn` is a psycopg2 connection. SQL is raw strings — there's no Alembic
op layer, no autogenerate.

Ordering rule: filenames / version ids sort lexicographically in the same
order migrations should be applied. Keep numbering sequential:
0001, 0002, 0003, ...
"""