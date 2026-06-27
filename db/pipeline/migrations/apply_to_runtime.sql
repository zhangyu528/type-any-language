-- apply_to_runtime.sql — inline application of db/pipeline/migrations/versions/0001-0006
-- to the running runtime db (type-any-language-db-1).
--
-- Equivalent to running `python3 -m pipeline.migrations.runner` against the
-- runtime db, but applied via docker exec + psql (the db image is
-- postgres:15-alpine — has psql, no python).
--
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS / ON CONFLICT)
-- except 0006's ADD CONSTRAINT, which assumes the constraint doesn't exist
-- (verified: the runtime db never had 0006 applied, so this is safe).
--
-- Bookkeeping: pre-mark all 6 versions in schema_migrations so the
-- migration runner thinks everything is up-to-date and becomes a no-op
-- on future `content.sh init-schema` calls.

\set ON_ERROR_STOP on

-- schema_migrations bookkeeping table (runner.py ensures this).
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ============================================================================
-- 0001_baseline: tables already exist (baked from 01-content.sql), no-op
-- ============================================================================
INSERT INTO schema_migrations (version) VALUES ('0001_baseline')
    ON CONFLICT DO NOTHING;

-- ============================================================================
-- 0002_vocab_metadata: +frequency +register +domain +example +tags
-- ============================================================================
ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS frequency INTEGER;
ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS register   VARCHAR(20);
ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS domain     VARCHAR(50);
ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS example    TEXT;
ALTER TABLE vocabulary_words ADD COLUMN IF NOT EXISTS tags       TEXT[];

CREATE INDEX IF NOT EXISTS ix_vocabulary_words_register ON vocabulary_words (register);
CREATE INDEX IF NOT EXISTS ix_vocabulary_words_domain   ON vocabulary_words (domain);
CREATE INDEX IF NOT EXISTS ix_vocabulary_words_tags     ON vocabulary_words USING GIN (tags);

INSERT INTO schema_migrations (version) VALUES ('0002_vocab_metadata')
    ON CONFLICT DO NOTHING;

-- ============================================================================
-- 0003_sentence_metadata: +topic +register +cefr +tags
-- ============================================================================
ALTER TABLE sentences ADD COLUMN IF NOT EXISTS topic    VARCHAR(50);
ALTER TABLE sentences ADD COLUMN IF NOT EXISTS register VARCHAR(20);
ALTER TABLE sentences ADD COLUMN IF NOT EXISTS cefr     VARCHAR(2);
ALTER TABLE sentences ADD COLUMN IF NOT EXISTS tags     TEXT[];

CREATE INDEX IF NOT EXISTS ix_sentences_topic    ON sentences (topic);
CREATE INDEX IF NOT EXISTS ix_sentences_register ON sentences (register);
CREATE INDEX IF NOT EXISTS ix_sentences_cefr     ON sentences (cefr);
CREATE INDEX IF NOT EXISTS ix_sentences_tags     ON sentences USING GIN (tags);

INSERT INTO schema_migrations (version) VALUES ('0003_sentence_metadata')
    ON CONFLICT DO NOTHING;

-- ============================================================================
-- 0004_sentence_word_links: table exists (verified), ensure indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS ix_sentence_word_links_word_id
    ON sentence_word_links (word_id);

INSERT INTO schema_migrations (version) VALUES ('0004_sentence_word_links')
    ON CONFLICT DO NOTHING;

-- ============================================================================
-- 0005_drop_dead_columns: drop is_cached / is_stale / refresh_count
-- ============================================================================
ALTER TABLE sentences DROP COLUMN IF EXISTS refresh_count;
ALTER TABLE sentences DROP COLUMN IF EXISTS is_stale;
ALTER TABLE sentences DROP COLUMN IF EXISTS is_cached;

INSERT INTO schema_migrations (version) VALUES ('0005_drop_dead_columns')
    ON CONFLICT DO NOTHING;

-- ============================================================================
-- 0006_sentence_natural_key: UNIQUE(lib_id, text, difficulty) + dedupe
-- ============================================================================
-- Dedupe: keep lowest id per (lib_id, text, difficulty).
-- Verified pre-run: 0 duplicates in current data, so DELETE is a no-op.
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
);

-- Constraint. The runner.py version of this has no IF NOT EXISTS —
-- runtime db never had 0006 applied, so the constraint doesn't exist yet.
-- If a re-run is needed, drop the constraint first manually.
ALTER TABLE sentences
    ADD CONSTRAINT sentences_natural_key
    UNIQUE (lib_id, text, difficulty);

INSERT INTO schema_migrations (version) VALUES ('0006_sentence_natural_key')
    ON CONFLICT DO NOTHING;

-- ============================================================================
-- Summary
-- ============================================================================
SELECT version, applied_at FROM schema_migrations ORDER BY version;
