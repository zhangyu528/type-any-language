"""
Lessons router — read-layer for the Target-Word Lesson feature.

A "lesson" is a fixed-size chunk of target words within a lib (5 by
default; per-lib override via manifest.yaml's libs[].lesson_size).
Each lesson groups its 5 words with all the sentences that contain
any of them, so the frontend can render the two-stage practice
session in a single round-trip.

Endpoints:
  GET /api/lessons                          List all lessons in a lib
  GET /api/lessons/{lib_id}/{lesson_index}  Single lesson with words + sentences
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.sentence import Sentence
from app.models.sentence_word_link import SentenceWordLink
from app.models.vocabulary import VocabularyLib, VocabularyWord
from app.schemas.lesson import (
    LessonDetail,
    LessonSentence,
    LessonSummary,
    WordInLesson,
)

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


@router.get("", response_model=List[LessonSummary])
def list_lessons(
    lib_id: UUID = Query(..., description="Vocabulary lib to list lessons for"),
    db: Session = Depends(get_db),
):
    """List every lesson in a lib: lesson_index + word_count.

    Rows with `lesson_index IS NULL` (pre-migration-0007 data on a
    pre-baked db image) are skipped — the runtime backend should have
    been re-baked already, but a freshly-migrated runtime DB may have
    NULLs only for the brief window between migration apply and re-bake.
    """
    # Defensive: 404 if the lib doesn't exist. A typo'd lib_id would
    # otherwise return an empty list, which the frontend would interpret
    # as "no lessons" rather than "no such lib".
    if not db.query(VocabularyLib.id).filter(VocabularyLib.id == lib_id).first():
        raise HTTPException(status_code=404, detail="lib not found")

    rows = (
        db.query(VocabularyWord.lesson_index, VocabularyWord.id)
        .filter(VocabularyWord.lib_id == lib_id)
        .filter(VocabularyWord.lesson_index.isnot(None))
        .all()
    )
    counts: Dict[int, int] = defaultdict(int)
    for lesson_index, _ in rows:
        counts[int(lesson_index)] += 1

    return [
        LessonSummary(lesson_index=idx, word_count=cnt)
        for idx, cnt in sorted(counts.items())
    ]


@router.get("/{lib_id}/all", response_model=LessonDetail)
def get_lib_full(
    lib_id: UUID,
    db: Session = Depends(get_db),
):
    """Whole-lib fetch — all words + all baked sentences in one round-trip.

    Used by the random-step drill in the translation UI. The
    `lesson_index` field on the response is always 0 — the response
    shape is borrowed from LessonDetail (so the frontend can reuse the
    same type), but this is a LIB-shaped payload, not a single lesson.

    `words` covers every target word in the lib (any lesson_index,
    including NULL pre-migration-0007 data is skipped — same defensive
    filter as `list_lessons`). `sentences_by_word` is keyed by
    lowercased word, exactly like the per-lesson endpoint.

    NB: this route MUST be registered before `/{lib_id}/{lesson_index}`,
    otherwise FastAPI will try to parse "all" as an int and 422.
    """
    if not db.query(VocabularyLib.id).filter(VocabularyLib.id == lib_id).first():
        raise HTTPException(status_code=404, detail="lib not found")

    words = (
        db.query(VocabularyWord)
        .filter(VocabularyWord.lib_id == lib_id)
        .filter(VocabularyWord.lesson_index.isnot(None))
        .order_by(VocabularyWord.created_at, VocabularyWord.id)
        .all()
    )
    word_ids = [w.id for w in words]
    sentence_rows = (
        db.query(Sentence, VocabularyWord.word)
        .join(SentenceWordLink, SentenceWordLink.sentence_id == Sentence.id)
        .join(VocabularyWord, VocabularyWord.id == SentenceWordLink.word_id)
        .filter(VocabularyWord.id.in_(word_ids))
        .all()
    )
    bucket: Dict[str, List[LessonSentence]] = defaultdict(list)
    for sent, word in sentence_rows:
        bucket[word.lower()].append(LessonSentence(
            id=sent.id,
            text=sent.text,
            chinese_text=sent.chinese_text or '',
            difficulty=sent.difficulty,
            audio_url=sent.audio_url or '',
        ))

    return LessonDetail(
        lib_id=lib_id,
        lesson_index=0,  # sentinel — the response is lib-shaped, not lesson-shaped
        words=[
            WordInLesson(
                id=w.id,
                word=w.word,
                phonetic=w.phonetic or '',
                translation=w.translation or '',
            )
            for w in words
        ],
        sentences_by_word=dict(bucket),
    )


@router.get("/{lib_id}/{lesson_index}", response_model=LessonDetail)
def get_lesson(
    lib_id: UUID,
    lesson_index: int,
    db: Session = Depends(get_db),
):
    """Single lesson: 5 target words + all sentences covering them.

    `sentences_by_word` is keyed by the lowercased `word` (matching
    `Sentence.target_words` and the frontend's lookup convention). The
    frontend picks a beginner sentence for Stage 1 audio and an
    intermediate sentence for Stage 2 dictation.
    """
    # Existence checks. A bad lib_id → 404; a bad lesson_index → empty
    # 404 (the lib exists but the lesson doesn't, e.g. asking for
    # lesson 999 on a lib with 50 lessons).
    if not db.query(VocabularyLib.id).filter(VocabularyLib.id == lib_id).first():
        raise HTTPException(status_code=404, detail="lib not found")

    words = (
        db.query(VocabularyWord)
        .filter(VocabularyWord.lib_id == lib_id)
        .filter(VocabularyWord.lesson_index == lesson_index)
        .order_by(VocabularyWord.created_at, VocabularyWord.id)
        .all()
    )
    if not words:
        raise HTTPException(
            status_code=404,
            detail=f"no lesson {lesson_index} for lib={lib_id}",
        )

    word_ids = [w.id for w in words]
    sentence_rows = (
        db.query(Sentence, VocabularyWord.word)
        .join(SentenceWordLink, SentenceWordLink.sentence_id == Sentence.id)
        .join(VocabularyWord, VocabularyWord.id == SentenceWordLink.word_id)
        .filter(VocabularyWord.id.in_(word_ids))
        .all()
    )

    # Bucket sentences by their target word (lowercased, matching how
    # `target_words` is normalized in the bake pipeline).
    bucket: Dict[str, List[LessonSentence]] = defaultdict(list)
    for sent, word in sentence_rows:
        bucket[word.lower()].append(LessonSentence(
            id=sent.id,
            text=sent.text,
            chinese_text=sent.chinese_text or '',
            difficulty=sent.difficulty,
            audio_url=sent.audio_url or '',
        ))

    return LessonDetail(
        lib_id=lib_id,
        lesson_index=lesson_index,
        words=[
            WordInLesson(
                id=w.id,
                word=w.word,
                phonetic=w.phonetic or '',
                translation=w.translation or '',
            )
            for w in words
        ],
        sentences_by_word=dict(bucket),
    )
