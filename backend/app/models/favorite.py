"""
UserFavorite — one row per favorited sentence or word.

Mirrors the legacy localStorage `me.collection` shape but lives on the
server so the collection survives device switches. `item_type`
discriminates the two kinds; `sentence_id` is set for sentences,
`word_text` (lowercased) for words. See migration 0015 for the
uniqueness + 1:1 binding rationale.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class UserFavorite(Base):
    __tablename__ = "user_favorites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_type = Column(String(8), nullable=False)  # 'sentence' | 'word'
    sentence_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sentences.id", ondelete="CASCADE"),
        nullable=True,
    )
    word_text = Column(String(120), nullable=True)
    lib_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
