"""
DailyActivity — pre-aggregated per (user, day) rollup.

Updated as a side effect of POST /api/practice/session/end. Read by
the dashboard's 4-week calendar (GET /api/dashboard) and Progress
Snapshot.

Why pre-aggregate:
  - Reading "today's sentence count" or "last 28 days" once per
    dashboard load must be O(days), not O(rows). The 4-week
    calendar is 28 rows, no aggregation needed.
  - The streak (current_streak) needs a per-day cursor; storing it
    derived from practice_sessions would require a generated column
    or a per-request window function.

activity_date is the SERVER's local date (date.today() in Python).
A future users.timezone column will let us store the user-local date;
until then, this is best-effort and documented in the migration.

The PK (user_id, activity_date) is the upsert key — the writer uses
INSERT … ON CONFLICT to bump the counters atomically.
"""
import uuid
from datetime import date

from sqlalchemy import Boolean, Column, Date, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class DailyActivity(Base):
    __tablename__ = "daily_activity"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    activity_date = Column(Date, primary_key=True)
    sentences_count = Column(Integer, nullable=False, default=0)
    correct_count = Column(Integer, nullable=False, default=0)
    sessions_count = Column(Integer, nullable=False, default=0)
    # daily_goal_hit is a convenience flag the dashboard reads instead
    # of recomputing "did today's count >= user's daily_goal". Set when
    # the rollup crosses the threshold; never unset (a later threshold
    # change leaves historical flags untouched).
    daily_goal_hit = Column(Boolean, nullable=False, default=False)