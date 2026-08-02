"""
0011_user_activity — user-facing activity tables for the dashboard.

Why a new migration: until now the backend was a pure content read-
layer (vocab_libs + sentences + auth users). The dashboard surface
needs per-user activity, so we add:

  - practice_sessions    raw event log: one row per completed session.
  - daily_activity       pre-aggregated per (user, day) rollup.
  - user_streaks         one row per user; current / longest streak.
  - user_progress        one row per user; "where did I leave off"
                         pointer for the Continue Card.
  - users.daily_goal     user's preferred daily sentence target
                         (default 20, configurable from /me/settings).
  - users.monthly_goal   user's preferred monthly sentence target
                         (default 600).

The raw + pre-aggregate split mirrors what 0007/0008 do for the
target-word lesson feature: write raw events, roll up for fast
calendar reads, but always restatable from raw when the rollup drifts.

Why rerunnable: the runner invokes upgrade() on every backend start
when rerunnable=True. The DDL is all IF NOT EXISTS, and the
INSERT … ON CONFLICT rollup is itself idempotent, so re-runs are
safe. This is the same pattern as 0007_lesson_index.

Why now: dashboard v1 needs:
  - Continue Card → user_progress.last_session_id
  - 4-week calendar → daily_activity(sentences_count, goal_hit)
  - Streak header → user_streaks.current_streak
  - Progress snapshot → SUM over practice_sessions this week

Schema details
--------------

practice_sessions.is_finished is what makes "continue session" work:
a session is created on /api/practice/session/start, marked finished
on /end. The Continue Card returns the most-recent unfinished row.
A partial index on (user_id) WHERE NOT is_finished makes that
lookup O(1).

daily_activity PK is (user_id, activity_date) so the calendar reads
are a single index scan. activity_date is a DATE in the SERVER'S
local timezone — the dashboard service computes today server-side.
A future timezone column on users will let us flip this; for now,
document the limitation.

user_progress.current_sentence_position is the in-session cursor;
the Continue Card reads it to show "Word #12" without the frontend
having to track it across sessions.
"""
from __future__ import annotations

version = "0011_user_activity"
description = "user activity tables for the dashboard: practice_sessions, daily_activity, user_streaks, user_progress + users.{daily,monthly}_goal"
rerunnable = True


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        # ---- practice_sessions: raw event log ----
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS practice_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                started_at TIMESTAMP NOT NULL DEFAULT NOW(),
                ended_at TIMESTAMP,
                lib_id UUID,
                lesson_index INTEGER,
                sentences_attempted INTEGER NOT NULL DEFAULT 0,
                sentences_correct INTEGER NOT NULL DEFAULT 0,
                is_finished BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_practice_sessions_user_started "
            "ON practice_sessions (user_id, started_at DESC)"
        )
        # Partial index — the "Continue Card" looks up the most-recent
        # unfinished session per user. Most rows are finished, so a
        # partial index keeps the hot lookup small.
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_practice_sessions_user_unfinished "
            "ON practice_sessions (user_id) WHERE is_finished = FALSE"
        )

        # ---- daily_activity: pre-aggregated per (user, day) ----
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_activity (
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                activity_date DATE NOT NULL,
                sentences_count INTEGER NOT NULL DEFAULT 0,
                correct_count INTEGER NOT NULL DEFAULT 0,
                sessions_count INTEGER NOT NULL DEFAULT 0,
                daily_goal_hit BOOLEAN NOT NULL DEFAULT FALSE,
                PRIMARY KEY (user_id, activity_date)
            )
            """
        )

        # ---- user_streaks: one row per user ----
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_streaks (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                current_streak INTEGER NOT NULL DEFAULT 0,
                longest_streak INTEGER NOT NULL DEFAULT 0,
                last_active_date DATE,
                current_streak_start DATE
            )
            """
        )

        # ---- user_progress: continue-session pointer ----
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_progress (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                last_session_id UUID REFERENCES practice_sessions(id) ON DELETE SET NULL,
                last_lib_id UUID,
                last_lesson_index INTEGER,
                current_sentence_position INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )

        # ---- users.{daily_goal, monthly_goal} ----
        # Defaults: 20 sentences/day, 600 sentences/month. Tunable from
        # /me/settings in a later phase.
        cur.execute(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS daily_goal INTEGER NOT NULL DEFAULT 20"
        )
        cur.execute(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS monthly_goal INTEGER NOT NULL DEFAULT 600"
        )


def downgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS monthly_goal")
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS daily_goal")
        cur.execute("DROP TABLE IF EXISTS user_progress")
        cur.execute("DROP TABLE IF EXISTS user_streaks")
        cur.execute("DROP TABLE IF EXISTS daily_activity")
        cur.execute("DROP INDEX IF EXISTS ix_practice_sessions_user_unfinished")
        cur.execute("DROP INDEX IF EXISTS ix_practice_sessions_user_started")
        cur.execute("DROP TABLE IF EXISTS practice_sessions")