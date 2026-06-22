"""
Sentence response schemas (read-layer).

The runtime only serves pre-baked sentences. Generation/validation
request schemas are gone — those workflows happen at bake time on the
CMS host (`scripts/cms/content.sh sentences` / `audio`).
"""
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class SentenceResponse(BaseModel):
    id: UUID
    text: str
    chinese_text: str = ''
    target_words: List[str]
    difficulty: str
    audio_url: Optional[str] = None

    class Config:
        from_attributes = True