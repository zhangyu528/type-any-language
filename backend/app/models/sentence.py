import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Sentence(Base):
    __tablename__ = "sentences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lib_id = Column(UUID(as_uuid=True), ForeignKey("vocabulary_libs.id"), nullable=False)
    text = Column(Text, nullable=False)
    chinese_text = Column(Text, default="")
    # target_words is a denormalized cache of the sentence_word_links FK table.
    # It is the lowercase list of vocabulary_words.word that this sentence
    # covers. The authoritative link is sentence_word_links; target_words
    # is kept for the runtime read-layer that already consumes it.
    target_words = Column(ARRAY(String), default=[])
    difficulty = Column(String(20), default="beginner")
    audio_url = Column(String(500), default="")
    # Phase 2 metadata columns.
    topic = Column(String(50), nullable=True)      # daily_life | business | travel | ...
    register = Column(String(20), nullable=True)   # formal | neutral | informal | slang
    cefr = Column(String(2), nullable=True)        # A1 / A2 / B1 / B2 / C1 / C2
    tags = Column(ARRAY(String), nullable=True)    # free-form array
    use_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # NOTE: previously had is_cached / is_stale / refresh_count. Removed in
    # migration 0005_drop_dead_columns -- post-read-layer refactor they were
    # always-true / never-written respectively, dead columns.

    lib = relationship("VocabularyLib")