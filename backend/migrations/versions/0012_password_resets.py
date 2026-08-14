"""
0012_password_resets — add password_resets table for the forgot-password flow.

Idempotent (CREATE TABLE IF NOT EXISTS). Schema follows
backend/app/models/user.py::PasswordReset:
  - password_resets: token_hash (PK, sha256 hex of the reset token),
    user_id (FK CASCADE into users), email, created_at, expires_at
    + ix on expires_at for cleanup sweeps

Auth-owning table (like users/sessions) — runtime-only, not part of the
CMS-baked content schema. One active reset per user at a time; the service
deletes prior rows on issue.

Downgrade drops the table. No content data is touched.
"""
from __future__ import annotations

version = "0012_password_resets"
description = "auth: create password_resets table"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS password_resets (
                token_hash   VARCHAR(64)  PRIMARY KEY,
                user_id      UUID         NOT NULL
                              REFERENCES users(id) ON DELETE CASCADE,
                email        VARCHAR(255) NOT NULL,
                created_at   TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
                expires_at   TIMESTAMP    NOT NULL
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_password_resets_user_id "
            "ON password_resets(user_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_password_resets_expires_at "
            "ON password_resets(expires_at)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS password_resets")
