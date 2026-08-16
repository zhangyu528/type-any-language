"""
0016_practice_attempts — per-sentence attempt log (the review data source).

Why: the dashboard already has aggregate practice counters
(practice_sessions.sentences_attempted / sentences_correct) and the
daily_activity rollup, but no per-sentence record. A spaced-repetition
("复习") surface needs to know *which* sentences the user got wrong and
*when* — aggregate counts can't answer "what should I review today?".

This table is the raw log: one row per /step outcome, carrying
sentence_id + correct + attempted_at. It is insert-only (the /end call
remains the authoritative source for the session totals + daily rollup,
so a lost /step batch never undercounts the streak). The review router
(querying "wrong in the last 14 days") is the first consumer.

Indexes:
  - (user_id, attempted_at): the review query's time-window scan.
  - (user_id, sentence_id): future per-sentence drill-history drawers.
"""
from __future__ import annotations

version = "0016_practice_attempts"
description = "practice_attempts: per-sentence attempt log for spaced review"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS practice_attempts (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID NOT NULL
                             REFERENCES users(id) ON DELETE CASCADE,
                session_id  UUID NULL
                             REFERENCES practice_sessions(id) ON DELETE CASCADE,
                sentence_id UUID NULL
                             REFERENCES sentences(id) ON DELETE CASCADE,
                lib_id      UUID NULL,
                correct     BOOLEAN NOT NULL,
                attempted_at TIMESTAMP NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_practice_attempts_user_time "
            "ON practice_attempts (user_id, attempted_at)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_practice_attempts_user_sentence "
            "ON practice_attempts (user_id, sentence_id)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS practice_attempts")
