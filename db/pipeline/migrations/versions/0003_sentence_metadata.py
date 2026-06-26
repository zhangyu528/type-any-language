"""
0003_sentence_metadata — add metadata columns to sentences.

Adds 4 nullable columns: topic, register, cefr (CEFR level A1-C2), tags.
All default NULL so existing rows keep their data unchanged. Backfill
can come from the LLM (via generate_sentences prompt template update) or
from operator-supplied CSV / SQL.

GIN index on tags for `tags @> ARRAY['...']` containment queries.
"""
from __future__ import annotations

version = "0003_sentence_metadata"
description = "sentences: +topic +register +cefr +tags"

import psycopg2


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS topic VARCHAR(50)")
        cur.execute("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS register VARCHAR(20)")
        cur.execute("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS cefr VARCHAR(2)")
        cur.execute("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS tags TEXT[]")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sentences_topic "
            "ON sentences (topic)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sentences_register "
            "ON sentences (register)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sentences_cefr "
            "ON sentences (cefr)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sentences_tags "
            "ON sentences USING GIN (tags)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS ix_sentences_tags")
        cur.execute("DROP INDEX IF EXISTS ix_sentences_cefr")
        cur.execute("DROP INDEX IF EXISTS ix_sentences_register")
        cur.execute("DROP INDEX IF EXISTS ix_sentences_topic")
        cur.execute("ALTER TABLE sentences DROP COLUMN IF EXISTS tags")
        cur.execute("ALTER TABLE sentences DROP COLUMN IF EXISTS cefr")
        cur.execute("ALTER TABLE sentences DROP COLUMN IF EXISTS register")
        cur.execute("ALTER TABLE sentences DROP COLUMN IF EXISTS topic")