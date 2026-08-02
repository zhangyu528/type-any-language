"""
PracticeSession — raw event log of one practice round.

Each call to POST /api/practice/session/start creates a new row. The
session is marked is_finished=True on POST /end and the daily_activity
rollup + user_streak update fire as a side effect.

Why a raw log in addition to the daily_activity rollup:
  - Debugging: a specific user reporting "my stats look wrong" can
    be traced back to the exact session row.
  - Restatability: if the rollup logic ever changes (e.g. a future
    streak freeze feature), we can rebuild daily_activity from raw.
  - Future per-sentence detail: a future "drill into session" drawer
    on the dashboard needs to know each sentence's outcome. When we
    add a practice_steps table it can FK back to this.

The unfinished-session lookup (Continue Card) uses the partial index
ix_practice_sessions_user_unfinished — small, fast, and bounded.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PracticeSession(Base):
    __tablename__ = "practice_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    # Lib/lesson context at session start. Nullable so a session that
    # has not yet picked a lib (homepage drill) can still be recorded.
    lib_id = Column(UUID(as_uuid=True), nullable=True)
    lesson_index = Column(Integer, nullable=True)
    sentences_attempted = Column(Integer, nullable=False, default=0)
    sentences_correct = Column(Integer, nullable=False, default=0)
    # is_finished = False means the session is still in progress and
    # is a candidate for the Continue Card.
    is_finished = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_practice_sessions_user_started", "user_id", "started_at"),
        # Partial index — kept named to mirror the migration's index.
        Index(
            "ix_practice_sessions_user_unfinished",
            "user_id",
            postgresql_where=Column("is_finished") == False,  # noqa: E712
        ),
    )