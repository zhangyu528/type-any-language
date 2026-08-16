"""
0013_course_fields — add course-catalog metadata to vocabulary_libs.

The "练习" partition became a browsable course catalog. A vocabulary lib is
the first course_type ("vocab"); future grammar / listening / exam courses
attach to the same surface via the `course_type` discriminator.

Columns:
  course_type   NOT NULL DEFAULT 'vocab'   — vocab/grammar/listening/exam
  category      nullable                   — exam/daily/business facet
  accent        nullable                   — color token (blue/green/amber/purple)
  lesson_count  nullable                   — total lessons (course体量)
  est_minutes   nullable                   — estimated total minutes
  order_index   NOT NULL DEFAULT 0         — catalog display order
  is_published  NOT NULL DEFAULT TRUE       — controls whether it shows in the catalog

Adding the NOT NULL columns with defaults keeps existing baked rows compatible
in a single ALTER (Postgres backfills the default for existing rows, no per-row
rewrite). The catalog endpoint filters is_published and orders by order_index.

Downgrade drops every column added here.
"""
from __future__ import annotations

version = "0013_course_fields"
description = "vocabulary_libs: +course fields (course_type/category/accent/lesson_count/est_minutes/order_index/is_published)"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE vocabulary_libs "
            "ADD COLUMN IF NOT EXISTS course_type VARCHAR(20) NOT NULL DEFAULT 'vocab', "
            "ADD COLUMN IF NOT EXISTS category VARCHAR(30), "
            "ADD COLUMN IF NOT EXISTS accent VARCHAR(20), "
            "ADD COLUMN IF NOT EXISTS lesson_count INTEGER, "
            "ADD COLUMN IF NOT EXISTS est_minutes INTEGER, "
            "ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0, "
            "ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE vocabulary_libs "
            "DROP COLUMN IF EXISTS course_type, "
            "DROP COLUMN IF EXISTS category, "
            "DROP COLUMN IF EXISTS accent, "
            "DROP COLUMN IF EXISTS lesson_count, "
            "DROP COLUMN IF EXISTS est_minutes, "
            "DROP COLUMN IF EXISTS order_index, "
            "DROP COLUMN IF EXISTS is_published"
        )
