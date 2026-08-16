"""
PracticeAttempt — one row per /step outcome (per-sentence attempt log).

The review surface reads from this to surface "what should I practice
today". Insert-only: the /end call stays authoritative for session
totals + the daily_activity rollup. See migration 0016.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PracticeAttempt(Base):
    __tablename__ = "practice_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("practice_sessions.id", ondelete="CASCADE"),
        nullable=True,
    )
    sentence_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sentences.id", ondelete="CASCADE"),
        nullable=True,
    )
    lib_id = Column(UUID(as_uuid=True), nullable=True)
    correct = Column(Boolean, nullable=False)
    attempted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
