import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class UserCourse(Base):
    """A user's enrollment in a course (vocabulary_lib).

    One row per (user, lib). The unique (user_id, lib_id) constraint
    makes add/remove idempotent. Both FKs cascade, so deleting a user
    or unpublishing a lib cleans up dangling rows automatically.
    """

    __tablename__ = "user_courses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    lib_id = Column(
        UUID(as_uuid=True),
        ForeignKey("vocabulary_libs.id", ondelete="CASCADE"),
        nullable=False,
    )
    added_at = Column(DateTime, default=datetime.utcnow)
    order_index = Column(Integer, nullable=False, default=0)

    lib = relationship("VocabularyLib")
