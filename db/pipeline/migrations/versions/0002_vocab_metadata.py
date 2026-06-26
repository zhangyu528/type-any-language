"""
0002_vocab_metadata — add metadata columns to vocabulary_words.

Adds 5 nullable columns for content slicing (frequency, register, domain,
example, tags). All default NULL so existing rows are unaffected — operator
can backfill via a CSV with the new columns or via LLM-assisted enrichment.

Additive, no data loss, no behavior change for old CSVs.
"""
from __future__ import annotations

version = "0002_vocab_metadata"
description = "vocabulary_words: +frequency +register +domain +example +tags"

import psycopg2


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        # Use ADD COLUMN IF NOT EXISTS (PG 9.6+) so re-runs are idempotent.
        cur.execute("ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS frequency INTEGER")
        cur.execute(
            "ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS register VARCHAR(20)"
        )
        cur.execute(
            "ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS domain VARCHAR(50)"
        )
        cur.execute(
            "ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS example TEXT"
        )
        cur.execute(
            "ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS tags TEXT[]"
        )
        # Index the discriminator columns we expect to filter on (register,
        # domain) and the tag array (GIN index for ARRAY contains queries).
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_vocabulary_words_register "
            "ON vocabulary_words (register)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_vocabulary_words_domain "
            "ON vocabulary_words (domain)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_vocabulary_words_tags "
            "ON vocabulary_words USING GIN (tags)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS ix_vocabulary_words_tags")
        cur.execute("DROP INDEX IF EXISTS ix_vocabulary_words_domain")
        cur.execute("DROP INDEX IF EXISTS ix_vocabulary_words_register")
        cur.execute("ALTER TABLE vocabulary_words DROP COLUMN IF EXISTS tags")
        cur.execute("ALTER TABLE vocabulary_words DROP COLUMN IF EXISTS example")
        cur.execute("ALTER TABLE vocabulary_words DROP COLUMN IF EXISTS domain")
        cur.execute("ALTER TABLE vocabulary_words DROP COLUMN IF EXISTS register")
        cur.execute("ALTER TABLE vocabulary_words DROP COLUMN IF EXISTS frequency")