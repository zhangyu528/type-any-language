"""
0010_auth_users_sessions — add users + sessions tables for v1 auth.

Idempotent. Schema follows backend/app/models/user.py:
  - users: id (UUID PK), email (UNIQUE), password_hash, display_name,
    is_active, created_at, last_login_at
  - sessions: token_hash (PK, sha256 hex), user_id (FK CASCADE),
    created_at, expires_at, last_seen_at + ix on expires_at for
    cleanup sweeps

The 3 content tables (vocabulary_libs/words/sentences) are owned by
the CMS bake and ship inside the db image. These two auth tables are
runtime-only and don't appear in the baked schema — they're created
on first backend boot against a fresh volume. For existing volumes
where the user might have run the backend before, the migration is
still safe (CREATE TABLE IF NOT EXISTS).

No FK from users → content tables. Auth is intentionally orthogonal
to the read-layer; a future "delete account" feature won't cascade
through vocabulary.

Downgrade drops the sessions table first (it has FK into users), then
users. Both are runtime-only so no content data is lost.
"""
from __future__ import annotations

version = "0010_auth_users_sessions"
description = "auth: create users + sessions tables"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        # sessions first child (FK into users), so users drop last on
        # downgrade. Order doesn't matter for create (no inter-table
        # FK in create) but we keep sessions first by convention.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash    VARCHAR(64)  PRIMARY KEY,
                user_id       UUID         NOT NULL
                              REFERENCES users(id) ON DELETE CASCADE,
                created_at    TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
                expires_at    TIMESTAMP    NOT NULL,
                last_seen_at  TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sessions_user_id "
            "ON sessions(user_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sessions_expires_at "
            "ON sessions(expires_at)"
        )

        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              UUID         PRIMARY KEY,
                email           VARCHAR(255) NOT NULL UNIQUE,
                password_hash   VARCHAR(255) NOT NULL,
                display_name    VARCHAR(100) NOT NULL DEFAULT '',
                is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
                created_at      TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
                last_login_at   TIMESTAMP    NULL
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_users_email "
            "ON users(email)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS sessions")
        cur.execute("DROP TABLE IF EXISTS users")
