"""
0001_baseline — capture the schema as of the Phase 1 / pre-Phase-2 state.

Pure SQL, no SQLAlchemy ORM dependency. The schema here is a manual
translation of backend/app/models/{vocabulary,sentence}.py as of the
end of Phase 1. Keeping migrations in plain SQL has two payoffs:

  1. The db image doesn't need to ship backend/app/ + pydantic + the
     full ORM dependency tree. migrations.runner only needs sqlalchemy
     and psycopg2-binary — both have cp314 musllinux wheels, no build
     toolchain required.
  2. The schema is reviewable as plain SQL, the way a DBA would write
     it. Migrations no longer go through Base.metadata.create_all()'s
     implicit CREATE TABLE synthesis, which is harder to diff.

If you change a model in backend/app/models/, mirror the change here
in a new migration (don't edit 0001 — it's already stamped as
applied on every existing DB).
"""
from __future__ import annotations

version = "0001_baseline"
description = "Baseline: 3 content tables (vocabulary_libs/words/sentences) + schema_migrations"


# Hand-translated from backend/app/models/vocabulary.py + sentence.py
# as of the end of Phase 1. CREATE TABLE IF NOT EXISTS is idempotent
# so this is safe to re-run on a fresh DB or an existing one.
_UPGRADE_SQL = r"""
CREATE TABLE IF NOT EXISTS vocabulary_libs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    level       VARCHAR(20)  NOT NULL,
    word_count  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS vocabulary_words (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    lib_id         UUID         NOT NULL REFERENCES vocabulary_libs(id) ON DELETE CASCADE,
    word           VARCHAR(100) NOT NULL,
    phonetic       VARCHAR(100) NOT NULL DEFAULT '',
    translation    TEXT         NOT NULL DEFAULT '',
    part_of_speech VARCHAR(20)  NOT NULL DEFAULT '',
    created_at     TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS sentences (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    lib_id        UUID    NOT NULL REFERENCES vocabulary_libs(id) ON DELETE CASCADE,
    text          TEXT    NOT NULL,
    chinese_text  TEXT    NOT NULL DEFAULT '',
    audio_url     TEXT    NOT NULL DEFAULT '',
    difficulty    VARCHAR(20) NOT NULL DEFAULT 'medium',
    created_at    TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
"""

_DOWNGRADE_SQL = r"""
DROP TABLE IF EXISTS sentences           CASCADE;
DROP TABLE IF EXISTS vocabulary_words    CASCADE;
DROP TABLE IF EXISTS vocabulary_libs    CASCADE;
DROP TABLE IF EXISTS schema_migrations  CASCADE;
"""


def upgrade(conn) -> None:
    """Create the 3 content tables + the schema_migrations bookkeeping
    table is owned by the runner (runner.ensure_schema_migrations_table
    is called before this). We only declare the content schema here.

    CREATE TABLE IF NOT EXISTS makes this idempotent: existing DBs
    no-op, fresh DBs get the 3 tables.
    """
    with conn.cursor() as cur:
        cur.execute(_UPGRADE_SQL)
    conn.commit()


def downgrade(conn) -> None:
    """Drop everything baseline created. Cascading because of the FKs.

    Destructive — wipes all data. Used by `downgrade_one()` for full
    rollback to pre-migration state.
    """
    with conn.cursor() as cur:
        cur.execute(_DOWNGRADE_SQL)
    conn.commit()