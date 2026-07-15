"""
0007_lesson_index — add lesson_index column to vocabulary_words + backfill.

The "Target-Word Lesson" feature (PRD v0.4.0+) groups each lib's words
into fixed-size lessons of N words (lesson_size = 5 by default). The
grouping is purely positional within a lib: words 1-5 → lesson 1,
words 6-10 → lesson 2, etc. The ordering source is (created_at, id),
matching what `etl.sh sync` produces on a fresh import.

Why positional rather than explicit grouping:
  - The CSV header has no `lesson` column. Adding one would force every
    operator-maintained CSV to be re-edited, which is friction. Position
    is a stable contract: import order is CSV order, so lesson_index
    is determined as soon as the row is inserted.
  - Operators can still get explicit grouping later by adding a `lesson`
    column to the CSV and an import-time override; this column is the
    starting point, not the final word.

Backfill is one UPDATE per lib using ROW_NUMBER(). It is idempotent:
running it on an already-populated column would overwrite the value,
which is fine if the operator changes lesson_size and re-syncs -- they
can rerun the backfill via the migration's upgrade().

The downgrade just drops the column. We do not preserve the previous
lesson_index values -- a downgrade is destructive by intent (the data
can always be regenerated from CSV order).
"""
from __future__ import annotations

version = "0007_lesson_index"
description = "vocabulary_words: +lesson_index (positional, per-lib, size=5)"

import psycopg2


# Default lesson size, mirrored from cms/source/manifest.yaml's
# defaults.lesson_size. Kept as a module constant so the migration is
# self-contained (doesn't need to read yaml to apply). If the operator
# changes lesson_size in the manifest and wants to re-bucket, they can
# run a one-off UPDATE (not part of this migration).
DEFAULT_LESSON_SIZE = 5


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        # 1. Add the column. Nullable for backward compat with rows that
        # pre-date this migration -- they'll be backfilled in step 2.
        cur.execute(
            "ALTER TABLE vocabulary_words "
            "ADD COLUMN IF NOT EXISTS lesson_index INTEGER"
        )

        # 2. Backfill: (row_number - 1) // lesson_size + 1, partitioned
        # by lib_id and ordered by (created_at, id). The composite
        # ordering matches what import_vocab.py produces (created_at is
        # stamped in Python at insert time, id is a uuid4 -- essentially
        # random but stable).
        cur.execute(
            f"""
            WITH ranked AS (
                SELECT id,
                       ((ROW_NUMBER() OVER (
                           PARTITION BY lib_id
                           ORDER BY created_at, id
                       ) - 1) / %s) + 1 AS new_lesson_index
                FROM vocabulary_words
            )
            UPDATE vocabulary_words vw
            SET lesson_index = ranked.new_lesson_index
            FROM ranked
            WHERE vw.id = ranked.id
            """,
            (DEFAULT_LESSON_SIZE,),
        )

        # 3. Index for the lessons router's hot query
        #     SELECT ... FROM vocabulary_words WHERE lib_id = ? AND lesson_index = ?
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_vocabulary_words_lib_lesson "
            "ON vocabulary_words (lib_id, lesson_index)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS ix_vocabulary_words_lib_lesson")
        cur.execute("ALTER TABLE vocabulary_words DROP COLUMN IF EXISTS lesson_index")
