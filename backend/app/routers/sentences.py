"""
Sentences router — read-layer only.

Sentences are pre-generated and baked into the db image by the CMS host
(`scripts/ops/db/content.sh sentences`). This router only serves them. No
generation, no AI, no TTS, no cache eviction — all of that is bake-time.

Endpoints:
  GET /api/sentences            List (with filters)
  GET /api/sentences/{id}       Single sentence
  GET /api/sentences/random     Random sample for practice
"""
import random
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.sentence import Sentence
from app.schemas.sentence import SentenceResponse

router = APIRouter(prefix="/api/sentences", tags=["sentences"])


@router.get("", response_model=List[SentenceResponse])
def list_sentences(
    lib_id: Optional[UUID] = Query(None, description="Filter by vocab lib"),
    difficulty: Optional[str] = Query(None, description="Filter by difficulty"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """List pre-baked sentences. Use filters to narrow."""
    query = db.query(Sentence)
    if lib_id:
        query = query.filter(Sentence.lib_id == lib_id)
    if difficulty:
        query = query.filter(Sentence.difficulty == difficulty)
    return query.limit(limit).all()


@router.get("/random", response_model=List[SentenceResponse])
def random_sentences(
    lib_id: UUID = Query(..., description="Vocab lib to sample from"),
    difficulty: str = Query("beginner"),
    count: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Random sample of baked sentences for a practice session."""
    query = (
        db.query(Sentence)
        .filter(Sentence.lib_id == lib_id, Sentence.difficulty == difficulty)
    )
    candidates = query.all()
    if not candidates:
        raise HTTPException(
            status_code=404,
            detail=f"no baked sentences for lib={lib_id} difficulty={difficulty}",
        )
    if len(candidates) <= count:
        return candidates
    return random.sample(candidates, count)


@router.get("/{sentence_id}", response_model=SentenceResponse)
def get_sentence(sentence_id: UUID, db: Session = Depends(get_db)):
    """Single sentence by id."""
    sentence = db.query(Sentence).filter(Sentence.id == sentence_id).first()
    if not sentence:
        raise HTTPException(status_code=404, detail="sentence not found")
    return sentence