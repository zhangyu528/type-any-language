"""
UserStreak — single-row-per-user streak counter.

Updated as a side effect of POST /api/practice/session/end. The
update logic lives in activity_service.update_streak_on_activity()
which decides whether today's practice extends, breaks, or starts
the streak.

current_streak: number of consecutive days ending on last_active_date
                where the user hit at least one sentence.
longest_streak: all-time max of current_streak; never decreases.
last_active_date: the most recent day a session ended.
current_streak_start: the first day of the current streak. Stored so
                      the dashboard can show "started 7 days ago"
                      without recomputing from a date table.
"""
import uuid
from datetime import date

from sqlalchemy import Column, Date, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class UserStreak(Base):
    __tablename__ = "user_streaks"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    current_streak = Column(Integer, nullable=False, default=0)
    longest_streak = Column(Integer, nullable=False, default=0)
    last_active_date = Column(Date, nullable=True)
    current_streak_start = Column(Date, nullable=True)