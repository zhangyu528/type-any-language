"""
0009_vocab_lib_description — add optional `description` column to vocabulary_libs.

The home screen (frontend/src/app/Home.tsx) renders a card per lib and uses
`description` as the supporting tagline under the lib name. The column is
nullable so existing baked dbs stay compatible without a backfill — the UI
hides the line when the value is NULL.

No index: this column is read in a single SELECT * from vocabulary_libs
during /api/cms/catalog, which is cheap even with 100s of libs. If we
later add a search-by-description feature, a trigram index would be the
right add-on — but it isn't needed yet.

Downgrade is destructive-by-design (drops the column and its data), mirroring
the migration 0007 lesson_index downgrade contract.
"""
from __future__ import annotations

version = "0009_vocab_lib_description"
description = "vocabulary_libs: +description (nullable, set from manifest)"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE vocabulary_libs "
            "ADD COLUMN IF NOT EXISTS description TEXT"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE vocabulary_libs DROP COLUMN IF EXISTS description")