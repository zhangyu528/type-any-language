"""
0015_user_favorites — per-user collection (sentences + words).

Why a dedicated table instead of the browser localStorage blob:
  - The old collection lived under `me.collection:<userId>` in
    localStorage. That is device-bound: favorites vanish when the user
    switches machines or clears browser storage, and there is no
    server-truth to rehydrate from. This migration makes the
    collection a first-class server-side resource so the "收藏" tab is
    the same on every device.

Shape:
  - One table holds both item kinds, discriminated by `item_type`
    ('sentence' | 'word'). A drill pair is 1:1 (one sentence ↔ one
    target word), so adding a sentence also adds its word and removing
    a sentence drops all the user's word rows (mirrors the legacy
    `removeFromCollection` which set `c.words = {}`).
  - `sentence_id` is a FK to sentences (ONLY for sentence items);
    `word_text` is the lowercased word (ONLY for word items). `lib_id`
    is denormalized onto sentence rows so the review query can filter
    by lib without a JOIN.

Uniqueness:
  - Partial unique indexes keep (user_id, sentence_id) and
    (user_id, word_text) unique within their item_type — duplicate
    adds are no-ops (ON CONFLICT DO NOTHING in the router).
"""
from __future__ import annotations

version = "0015_user_favorites"
description = "user_favorites: per-user sentence/word collection (was localStorage-only)"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_favorites (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id    UUID NOT NULL
                            REFERENCES users(id) ON DELETE CASCADE,
                item_type  VARCHAR(8) NOT NULL,
                sentence_id UUID NULL
                            REFERENCES sentences(id) ON DELETE CASCADE,
                word_text  VARCHAR(120) NULL,
                lib_id     UUID NULL,
                created_at TIMESTAMP NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_favorites_user "
            "ON user_favorites (user_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_favorites_user_lib "
            "ON user_favorites (user_id, lib_id)"
        )
        # Partial unique indexes — one slot per sentence, one per word,
        # per user. The WHERE predicate must match the ON CONFLICT
        # clause in the router exactly.
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_favorites_sentence "
            "ON user_favorites (user_id, sentence_id) "
            "WHERE item_type = 'sentence' AND sentence_id IS NOT NULL"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_favorites_word "
            "ON user_favorites (user_id, word_text) "
            "WHERE item_type = 'word' AND word_text IS NOT NULL"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS user_favorites")
