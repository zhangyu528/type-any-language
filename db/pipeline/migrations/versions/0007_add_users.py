"""
0007_add_users — create the users table for v1 auth.

Why a separate migration (not folded into 0001_baseline): users is NOT a
content table — it's owned by the runtime (write path), not the CMS bake.
Keeping it outside the content schema lifecycle keeps the read-layer /
bake-time story pure. Mirrors the same separation as future tables
(history, practice_attempts) will follow.

Idempotent: CREATE TABLE / INDEX use IF NOT EXISTS, so re-running on a
DB that already has the table (e.g. from db/init/01-content.sql baking
or a prior migrate) is a no-op.

Fields:
  - id UUID PK                 — mirror existing UUID PK convention
  - email VARCHAR(255) UNIQUE  — login identity, case-insensitive at lookup
  - password_hash VARCHAR(255) — passlib bcrypt output (~60 chars; 255 leaves
                                 headroom for future algorithm migration)
  - display_name VARCHAR(50)   — shown in Header + /history
  - role VARCHAR(20) NULL      — reserved for future admin/premium gating
  - tier VARCHAR(20) NULL      — reserved for future subscription tier
  - is_active BOOLEAN          — reserved for future soft-delete / ban flow
  - created_at / updated_at    — standard audit timestamps

The LOWER(email) unique index makes login case-insensitive (Alice@example.com
== alice@example.com) while keeping `email` itself stored verbatim for display.
"""
from __future__ import annotations

version = "0007_add_users"
description = "Create users table for v1 auth (email/password, role/tier reserved)"

import psycopg2


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
                email         VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                display_name  VARCHAR(50)  NOT NULL,
                role          VARCHAR(20)  NULL,
                tier          VARCHAR(20)  NULL,
                is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
                created_at    TIMESTAMP    NOT NULL DEFAULT now(),
                updated_at    TIMESTAMP    NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower "
            "ON users (LOWER(email))"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_users_role "
            "ON users (role) WHERE role IS NOT NULL"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS ix_users_role")
        cur.execute("DROP INDEX IF EXISTS ix_users_email_lower")
        cur.execute("DROP TABLE IF EXISTS users")