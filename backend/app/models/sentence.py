import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Sentence(Base):
    __tablename__ = "sentences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lib_id = Column(UUID(as_uuid=True), ForeignKey("vocabulary_libs.id"), nullable=False)
    text = Column(Text, nullable=False)
    chinese_text = Column(Text, default='')
    target_words = Column(ARRAY(String), default=[])
    difficulty = Column(String(20), default="beginner")
    audio_url = Column(String(500), default="")
    is_cached = Column(Boolean, default=True)
    use_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    lib = relationship("VocabularyLib")
