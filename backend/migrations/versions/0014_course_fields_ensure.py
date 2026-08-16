"""
0014_course_fields_ensure — convergence migration for vocabulary_libs course columns.

Why this exists:
  0013_course_fields added the 7 course-catalog columns in a single
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement. The minimal runner
  (runner.py) stamps a migration as applied the first time it runs and then
  SKIPS it forever (current version >= 0013 → 0013 is "done"). If an early
  draft of 0013 was applied before all 7 columns were present in the file,
  the missing columns never get created and the catalog query 500s with
  `UndefinedColumn: vocabulary_libs.course_type does not exist`.

  This migration re-issues the same `ADD COLUMN IF NOT EXISTS` for every
  course column. `IF NOT EXISTS` makes it a safe no-op for columns that are
  already there, so it converges any partial state (missing 1, missing 5,
  or all present) to the full 7-column shape without error. It runs once,
  stamps, and is then skipped like any normal migration.

Columns (idempotent — each guarded by IF NOT EXISTS):
  course_type   NOT NULL DEFAULT 'vocab'
  category      nullable
  accent        nullable
  lesson_count  nullable
  est_minutes   nullable
  order_index   NOT NULL DEFAULT 0
  is_published  NOT NULL DEFAULT TRUE
"""
from __future__ import annotations

version = "0014_course_fields_ensure"
description = "vocabulary_libs: ensure all course columns exist (converge partial 0013 apply)"


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
    # Best-effort convergence only — nothing to remove here; the original
    # columns belong to 0013's downgrade path.
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
