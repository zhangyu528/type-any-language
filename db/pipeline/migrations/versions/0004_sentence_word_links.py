"""
0004_sentence_word_links — add proper FK table for sentence ↔ word relation.

Replaces the soft join (sentences.target_words STRING[] matched by lowercased
string against vocabulary_words.word) with a typed FK table. New column
sentence_word_links(sentence_id, word_id) is the canonical join source.

sentences.target_words is preserved as a denormalized cache (for the existing
runtime read-layer that's reading it via the API) but is no longer the
authoritative link. Future migrations / code can rely on the FK table for
correctness, knowing that target_words may be slightly stale or empty for
old rows.

The FK cascade on DELETE means deleting a vocabulary_word also removes
sentence_word_links rows — a sentence's target_words cache will still hold
the orphaned string, which the runtime can choose to ignore or scrub.

Additive, no data loss.
"""
from __future__ import annotations

version = "0004_sentence_word_links"
description = "New table sentence_word_links(sentence_id, word_id) — typed FK for sentence ↔ word"

import psycopg2


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sentence_word_links (
                sentence_id UUID NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
                word_id     UUID NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
                PRIMARY KEY (sentence_id, word_id)
            )
            """
        )
        # Reverse lookup: "give me all sentences covering word X" is a common
        # query for the future coverage-reporting endpoint. Index word_id.
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sentence_word_links_word_id "
            "ON sentence_word_links (word_id)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS ix_sentence_word_links_word_id")
        cur.execute("DROP TABLE IF EXISTS sentence_word_links")