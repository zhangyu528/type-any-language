"""
Sentence response schemas (read-layer).

The runtime only serves pre-baked sentences. Generation/validation
request schemas are gone — those workflows happen at bake time on the
CMS host (`scripts/ops/cms/content.sh sentences` / `audio`).
"""
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SentenceResponse(BaseModel):
    """A baked practice sentence. Read-only on the target host.

    `register` shadows BaseModel.register() in Pydantic v2 (it's used for
    class registration), so we name the python attribute `register_` and
    alias the wire name back to `register` for API compatibility. Same
    trick for SentenceWordResponse below.
    """
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    text: str
    chinese_text: str = ''
    # target_words is the denormalized cache of sentence_word_links.word_id
    # joined back to vocabulary_words.word. Authoritative source is the FK
    # table; for client validation we still expose the lowercase word list
    # so the frontend can compare directly.
    target_words: List[str]
    difficulty: str
    audio_url: Optional[str] = None
    # Phase 2 metadata. Nullable -- legacy rows have NULL.
    topic: Optional[str] = None
    register_: Optional[str] = Field(default=None, alias="register")
    cefr: Optional[str] = None
    tags: Optional[List[str]] = None


class SentenceWordResponse(BaseModel):
    """A vocabulary_word reached via sentence_word_links FK.

    Used by GET /api/sentences/{id}/words -- the authoritative join for
    "what words does this sentence cover". Returns more metadata than the
    SentenceResponse.target_words string list (frequency, domain, etc.)
    so future product features (e.g. "highlight high-frequency words
    inside the practice cell") can use it directly.
    """
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    word: str
    phonetic: str = ''
    translation: str = ''
    part_of_speech: str = ''
    frequency: Optional[int] = None
    register_: Optional[str] = Field(default=None, alias="register")
    domain: Optional[str] = None
    example: Optional[str] = None
    tags: Optional[List[str]] = None
