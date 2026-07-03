"""
Lesson response schemas (read-layer).

The Target-Word Lesson feature (PRD v0.4.0+) groups each lib's words into
fixed-size lessons (5 words by default; per-lib override possible). Each
lesson = 5 target words + all sentences that contain any of them, across
all 3 difficulty buckets, so the frontend can pick the right sentence
per stage without a second round-trip.

Why we return all 3 difficulties instead of just one per word:
  - Stage 1 (识词) plays a beginner sentence's audio for context.
  - Stage 2 (听写) needs an intermediate sentence for the dictation cell.
  - The frontend picks which to use; the backend doesn't need to know
    which sentence pairs with which stage.
"""
from __future__ import annotations

from typing import Dict, List
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LessonSummary(BaseModel):
    """One row in the lesson list. Status is NOT included — it lives in
    client localStorage (per the PRD's no-server-progress stance)."""
    lesson_index: int
    word_count: int


class WordInLesson(BaseModel):
    """A target word in a lesson. Minimal shape — enough for Stage 1
    (识词) display + Stage 2 (听写) sentence matching."""
    id: UUID
    word: str
    phonetic: str = ''
    translation: str = ''


class LessonDetail(BaseModel):
    """Full lesson payload: 5 target words + the sentences that cover
    them, bucketed by word so the frontend can pick per stage."""
    model_config = ConfigDict(populate_by_name=True)

    lib_id: UUID
    lesson_index: int
    words: List[WordInLesson]
    sentences_by_word: Dict[str, List["LessonSentence"]] = Field(
        default_factory=dict,
        description=(
            "Map of lowercased target word → all sentences (across all "
            "difficulties) that contain that word via sentence_word_links. "
            "Empty list for words with no baked sentences yet."
        ),
    )


class LessonSentence(BaseModel):
    """Slim sentence shape for the lesson payload. Mirrors the relevant
    fields of SentenceResponse but omits Phase 2 metadata that isn't
    used by the lesson UI.

    `chinese_text` is included so the dictation stage can show its hint
    without a second round-trip; the full `SentenceResponse` carries
    more fields that the lesson UI doesn't consume (target_words,
    topic, register, cefr, tags)."""
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    text: str
    chinese_text: str = ''
    difficulty: str
    audio_url: str = ''


# Resolve the forward reference now that LessonSentence is defined.
LessonDetail.model_rebuild()
