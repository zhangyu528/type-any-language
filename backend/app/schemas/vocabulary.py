from pydantic import BaseModel
from typing import Optional
from uuid import UUID


class VocabularyLibResponse(BaseModel):
    id: UUID
    name: str
    level: str
    word_count: int
    description: Optional[str] = None  # nullable; populated from manifest on bake

    class Config:
        from_attributes = True


class VocabularyWordResponse(BaseModel):
    id: UUID
    word: str
    phonetic: str
    translation: str
    part_of_speech: str

    class Config:
        from_attributes = True
