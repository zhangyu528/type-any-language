"""
0018_drop_monthly_goal — retire users.monthly_goal.

Why: the dashboard's per-month target turned out to be redundant once
the home page gained a per-day goal ring (the only ring users
actually look at). We replaced the old "本月目标" hero widget with a
learning-level widget driven by lifetime total_sentences, so the
monthly_goal column no longer drives anything in the UI. Front
end-side, the corresponding field has been removed from
DashboardSnapshot and from updateMonthlyGoal, and the matching CSS
is gone from GreetingBar / GoalRings / achievements / DataSection /
StreakMomentum. This migration retires the column on the backend so
the two halves stay in sync.

The downgrade is intentionally a no-op beyond a placeholder — once
we've shipped users off the monthly concept, dropping the column
back on the way down would just resurrect dead code. Callers that
still need a monthly signal can derive one on the fly from
practice_sessions if it ever comes back.
"""
from __future__ import annotations

version = "0018_drop_monthly_goal"
description = "drop users.monthly_goal (no longer surfaced anywhere in the UI)"
rerunnable = True


def upgrade(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS monthly_goal")


def downgrade(conn) -> None:
    # Re-add the column so the schema version can be rewound, but leave
    # it nullable so this downgrade never accidentally fakes a
    # 600-sentence default for existing users.
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS monthly_goal INTEGER"
        )