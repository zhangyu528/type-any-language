import uuid
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class VocabularyLib(Base):
    __tablename__ = "vocabulary_libs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    level = Column(String(20), nullable=False)  # beginner/cet4/cet6/ielts
    word_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    words = relationship("VocabularyWord", back_populates="lib")


class VocabularyWord(Base):
    __tablename__ = "vocabulary_words"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lib_id = Column(UUID(as_uuid=True), ForeignKey("vocabulary_libs.id"), nullable=False)
    word = Column(String(100), nullable=False)
    phonetic = Column(String(100), default="")
    translation = Column(Text, default="")
    part_of_speech = Column(String(20), default="")  # noun/verb/adj/adv
    # Phase 2 metadata columns. All nullable -- old CSVs / rows have NULLs.
    # CSV header can carry these as optional columns: see import_vocab.py.
    frequency = Column(Integer, nullable=True)
    register = Column(String(20), nullable=True)   # formal | neutral | informal | slang
    domain = Column(String(50), nullable=True)     # business | travel | tech | ...
    example = Column(Text, nullable=True)
    tags = Column(ARRAY(String), nullable=True)    # free-form array
    # Target-Word Lesson feature (PRD v0.4.0+): groups words into fixed-size
    # lessons within a lib. Nullable for rows that pre-date migration 0007.
    lesson_index = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    lib = relationship("VocabularyLib", back_populates="words")