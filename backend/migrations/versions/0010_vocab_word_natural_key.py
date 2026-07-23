"""
0010_vocab_word_natural_key — add UNIQUE constraint on (lib_id, word).

Pre-existing latent inconsistency: vocabulary_words had no natural-key
constraint, so two CSVs with the same (lib, word) would create two rows
on a naive re-import. importer worked around this with a
SELECT-then-INSERT check, but the check is silent on field changes:
CSV edits to phonetic / translation / tags after a row exists were
ignored (the SELECT saw the row and skipped the UPDATE).

Now that vocabulary_words is the canonical word entity (lesson_index
joins, sentence_word_links FK target, /api/vocabulary phonetics lookup),
identity should be deterministic by (lib, word). This migration:

  1. Deduplicates any pre-existing duplicate (lib_id, word) rows, keeping
     the lowest id per natural key. ON DELETE CASCADE on
     sentence_word_links cleans up links to dropped duplicates.
  2. Adds the UNIQUE constraint.

After this migration, importer.py's _upsert_words switches from
SELECT-then-INSERT to INSERT ... ON CONFLICT (lib_id, word) DO UPDATE,
so re-imports pick up CSV field changes. Safe to re-run: dedupe is a
no-op on already-clean dbs; the constraint addition is gated by
pg_constraint existence check (same pattern as 0006).
"""
from __future__ import annotations

version = "0010_vocab_word_natural_key"
description = "Add UNIQUE(lib_id, word) on vocabulary_words; dedupe first"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        # 1. Dedupe -- keep the lowest id per (lib_id, word). FK cascade
        # on sentence_word_links cleans up links to dropped duplicates.
        cur.execute(
            """
            DELETE FROM vocabulary_words
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY lib_id, word
                               ORDER BY id
                           ) AS rn
                    FROM vocabulary_words
                ) t
                WHERE t.rn > 1
            )
            """
        )
        # 2. Add the constraint, idempotent via pg_constraint check.
        cur.execute(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'vocabulary_words_natural_key'
                ) THEN
                    ALTER TABLE vocabulary_words
                        ADD CONSTRAINT vocabulary_words_natural_key
                        UNIQUE (lib_id, word);
                END IF;
            END $$;
            """
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE vocabulary_words "
            "DROP CONSTRAINT IF EXISTS vocabulary_words_natural_key"
        )