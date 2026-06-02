from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID


class SentenceGenerateRequest(BaseModel):
    lib_id: UUID
    count: int = 10
    difficulty: str = "beginner"
    force_new: bool = False
    allow_stale: bool = False


class SentenceResponse(BaseModel):
    id: UUID
    text: str
    chinese_text: str = ''
    target_words: List[str]
    difficulty: str
    audio_url: Optional[str] = None
    is_cached: bool = False

    class Config:
        from_attributes = True


class SentenceGenerateResponse(BaseModel):
    session_id: str
    sentences: List[SentenceResponse]


class AnswerCheckRequest(BaseModel):
    sentence_id: UUID
    user_input: str


class AnswerCheckResponse(BaseModel):
    is_correct: bool
    correct_answer: str


class CacheStatsResponse(BaseModel):
    total: int
    stale: int
    non_stale: int
    low_use: int


class CacheEvictRequest(BaseModel):
    lib_id: Optional[UUID] = None
    difficulty: Optional[str] = None
    dry_run: bool = True


class CacheEvictResponse(BaseModel):
    evicted_count: int
    dry_run: bool


class PrewarmRequest(BaseModel):
    lib_id: UUID
    difficulty: str = "beginner"
    target_count: int = 50


class PrewarmResponse(BaseModel):
    generated_count: int
