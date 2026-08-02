"""
UserProgress — "where did I leave off" pointer for the Continue Card.

One row per user. Updated:
  - On POST /api/practice/session/start (last_session_id, last_lib_id,
    last_lesson_index all get fresh values; current_sentence_position
    resets to 0).
  - On POST /api/practice/session/{id}/step (current_sentence_position
    advances).
  - On POST /api/practice/session/{id}/end (is_finished=True on the
    session; user_progress.last_session_id is left pointing to the
    finished session, so the next start overwrites it. We do not
    clear it on end — the Continue Card should fall back to "most
    recent finished" if no unfinished exists.)

Why a separate table instead of "most recent practice_session row":
  - Faster: PK lookup, no ORDER BY + LIMIT.
  - Joinable: last_lib_id / last_lesson_index are denormalized so
    the Continue Card doesn't have to JOIN practice_sessions to read
    them. Saves one query per dashboard load.
  - One write per start, one write per step — bounded cost.

The last_session_id FK is ON DELETE SET NULL so cleaning up an old
session (rare) doesn't crash the dashboard; the next /start overwrites
it anyway.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class UserProgress(Base):
    __tablename__ = "user_progress"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    last_session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("practice_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_lib_id = Column(UUID(as_uuid=True), nullable=True)
    last_lesson_index = Column(Integer, nullable=True)
    current_sentence_position = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)