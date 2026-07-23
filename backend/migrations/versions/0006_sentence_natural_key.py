"""
0006_sentence_natural_key — add UNIQUE constraint on (lib_id, text, difficulty).

Pre-existing latent bug: cms/pipeline/generate_sentences.py's
INSERT ... ON CONFLICT DO NOTHING assumed a unique constraint on this
natural key, but the original schema only had `id` as PK. So every rerun
silently created duplicate sentence rows for the same (lib, text,
difficulty). The duplicates are harmless at runtime (different IDs but
same content) but inflate the bake, bloat the audio dump, and make
sentence_word_links FK fan-out unnecessarily.

Now that the prompt template asks for stable metadata (topic/register/
cefr/tags) and we have a real sentence_word_links FK join, sentence
identity should be deterministic by content. This migration:

  1. Deletes any existing duplicate rows (keep lowest id per natural key).
     This is a one-time cleanup; idempotent against already-deduplicated DBs.
  2. Adds the UNIQUE constraint.

The cleanup uses a DELETE ... WHERE id IN (SELECT id FROM ... WHERE row_number > 1)
pattern. It's a single SQL statement; safe under autocommit. We dedupe
before adding the constraint, otherwise ADD CONSTRAINT would fail.
"""
from __future__ import annotations

version = "0006_sentence_natural_key"
description = "Add UNIQUE(lib_id, text, difficulty) on sentences; dedupe first"

import psycopg2


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        # 1. Dedupe -- keep the lowest id per (lib_id, text, difficulty).
        # Any ties broken by created_at. ON DELETE CASCADE on
        # sentence_word_links cleans up links to the dropped duplicates.
        cur.execute(
            """
            DELETE FROM sentences
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY lib_id, text, difficulty
                               ORDER BY id
                           ) AS rn
                    FROM sentences
                ) t
                WHERE t.rn > 1
            )
            """
        )
        # 2. Add the constraint. Postgres rejects duplicate values at this
        # point, which is why step 1 must run first.
        cur.execute(
            """
            ALTER TABLE sentences
            ADD CONSTRAINT sentences_natural_key
            UNIQUE (lib_id, text, difficulty)
            """
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE sentences DROP CONSTRAINT IF EXISTS sentences_natural_key"
        )
