"""
0017_user_courses — per-user enrolled course set ("我的课程").

Why: until now the 课程 center rendered the *entire* published catalog
and had no concept of "which courses belong to this user". That breaks
the product model the dashboard is moving toward — a user browses a
course catalog (发现), *adds* courses they care about, and then practices
from their own curated set (我的课程). This table is that curated set.

Shape:
  - One row per (user, lib). The unique index makes add/remove
    idempotent at the DB level.
  - `order_index` lets the UI keep a stable display order later
    (e.g. most-recently-added first); defaults to 0 for now.
  - Both FKs cascade: deleting a user wipes their enrollments, and
    unpublishing/deleting a lib removes dangling enrollments.

Default seeding (HISTORICAL): auth_service.create_user originally enrolled
every `level='beginner' AND is_published=True` lib on signup, but that
auto-starter was removed — signup no longer adds any course, so a fresh
account's 我的课程 starts EMPTY and the frontend first-run guide prompts a
pick (see auth_service.create_user).
"""
from __future__ import annotations

version = "0017_user_courses"
description = "user_courses: per-user enrolled course set (my courses)"


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_courses (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id    UUID NOT NULL
                            REFERENCES users(id) ON DELETE CASCADE,
                lib_id     UUID NOT NULL
                            REFERENCES vocabulary_libs(id) ON DELETE CASCADE,
                added_at   TIMESTAMP NOT NULL DEFAULT now(),
                order_index INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_courses_user "
            "ON user_courses (user_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_user_courses_user_lib "
            "ON user_courses (user_id, lib_id)"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_courses_user_lib "
            "ON user_courses (user_id, lib_id)"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS user_courses")
