"""
0008_sentence_word_links_backfill — populate sentence_word_links from
sentences.target_words for runtime dbs baked before the FK-population
logic landed in generate_sentences.py.

Background: migration 0004 created the sentence_word_links table but
never backfilled it. New bakes (run via generate_sentences.py ≥ the
FK-population commit) populate it at insert time, so fresh bakes are
fine. But any runtime db baked from an older snapshot has an empty
FK table even though sentences.target_words (the legacy string-array
cache) is fully populated. The lesson feature's
  /api/lessons/{lib_id}/{lesson_index}  endpoint joins through
sentence_word_links, so an unbaked runtime db returns no sentences
for any word and Stage 1/2 audio/dictation can't run.

Backfill SQL:
  1. For every (sentence, target_word) pair, look up the matching
     vocabulary_words.id by lowercased join. This mirrors the lookup
     generate_sentences.py uses at insert time.
  2. Insert into sentence_word_links. ON CONFLICT DO NOTHING makes the
     migration idempotent — a re-run is a no-op for already-linked rows.
  3. Skip rows where the target_word has no matching vocabulary_word.
     These are dead references in target_words (e.g. a word was
     deleted from the lib after the sentence was generated) and are
     harmless to ignore — the soft join on target_words at the runtime
     layer already tolerates this.

The unnest(text[]) → rows pattern handles sentences whose target_words
contains 0..N words in one statement, no per-row Python loop needed.

Idempotency contract: re-running this migration is safe. ON CONFLICT
DO NOTHING handles re-inserts; the FK cascade on vocabulary_words.delete
ensures orphaned links stay cleaned up. There is no downgrade — the
backfill is purely additive.
"""
from __future__ import annotations

version = "0008_sentence_word_links_backfill"
description = "Backfill sentence_word_links from sentences.target_words (idempotent)"
# Marked rerunnable so the runner re-invokes upgrade() even when this
# version is already stamped. upgrade() is fully idempotent:
#   - INSERT ... ON CONFLICT DO NOTHING — re-running is a no-op for
#     already-linked rows, and inserts any new (sentence, target_word)
#     pairs that have appeared since the last apply (e.g. fresh
#     sentences imported via import_content.sh after the migration
#     was first applied on an empty db).
#
# Why rerunnable: the original first-apply path on a fresh docker
# postgres sees an empty sentences table, so the backfill inserts 0
# rows. Later, import_content.sh UPSERTs sentences via the legacy
# importer (no FK-population logic) — sentence_word_links stays empty
# because this migration is already stamped. Re-running on every
# backend start self-heals this empty-db-first-apply race without
# requiring any per-host migration re-invocation.
rerunnable = True


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sentence_word_links (sentence_id, word_id)
            SELECT s.id, vw.id
            FROM sentences s
            CROSS JOIN LATERAL unnest(s.target_words) AS tw(raw_word)
            JOIN vocabulary_words vw
              ON vw.lib_id = s.lib_id
             AND LOWER(vw.word) = LOWER(tw.raw_word)
            ON CONFLICT DO NOTHING
            """
        )


def downgrade(conn) -> None:
    # Backfill is additive — there is no clean "undo" without knowing
    # which rows came from this migration vs. a fresh bake. Leave the
    # table intact on downgrade; the operator can truncate manually.
    pass