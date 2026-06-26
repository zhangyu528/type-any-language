"""
sentence_word_link.py — typed FK join between sentences and vocabulary_words.

Replaces the soft string-match join via sentences.target_words (a TEXT[]
matched lowercased against vocabulary_words.word). The FK table is the
authoritative source for "sentence X covers words Y, Z, W"; target_words
on the Sentence row is a denormalized cache for the read-layer backend.

Composite primary key (sentence_id, word_id) prevents duplicate links.
Both FKs cascade on delete so removing a vocabulary_word (or sentence)
cleans up its links automatically.
"""
import uuid
from sqlalchemy import Column, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class SentenceWordLink(Base):
    __tablename__ = "sentence_word_links"

    sentence_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sentences.id", ondelete="CASCADE"),
        primary_key=True,
    )
    word_id = Column(
        UUID(as_uuid=True),
        ForeignKey("vocabulary_words.id", ondelete="CASCADE"),
        primary_key=True,
    )