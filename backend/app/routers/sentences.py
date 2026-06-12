import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID

from app.database import get_db
from app.models.vocabulary import VocabularyWord
from app.models.sentence import Sentence
from app.schemas.sentence import (
    SentenceGenerateRequest,
    SentenceGenerateResponse,
    SentenceResponse,
    AnswerCheckRequest,
    AnswerCheckResponse,
    CacheStatsResponse,
    CacheEvictRequest,
    CacheEvictResponse,
    PrewarmRequest,
    PrewarmResponse,
)
from app.services.ai_service import get_ai_service
from app.services.cache_service import CacheService
from app.services.tts_service import generate_audio, text_to_audio_filename
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/sentences", tags=["sentences"])


def generate_sentences_for_words(db: Session, lib_id: UUID, words: list[str], difficulty: str, count: int) -> list[Sentence]:
    """Generate sentences for given words and save to DB."""
    ai_service = get_ai_service()
    sentences = []

    try:
        generated = ai_service.generate_sentences(words, count)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {str(e)}")

    for item in generated:
        text = item.get("text", "")
        chinese_text = item.get("chinese_text", "")
        target_words = item.get("target_words", [])
        if not text:
            continue
        sentence = Sentence(
            lib_id=lib_id,
            text=text,
            chinese_text=chinese_text,
            target_words=target_words,
            difficulty=difficulty,
            audio_url="",
            is_cached=True,
            use_count=1,
            last_used_at=datetime.utcnow(),
        )
        db.add(sentence)
        sentences.append(sentence)

    db.commit()
    for s in sentences:
        db.refresh(s)
        # Generate audio via Tencent Cloud TTS (retry up to 3 times)
        audio_url = ""
        last_err = None
        for attempt in range(3):
            try:
                filename = text_to_audio_filename(s.text)
                generate_audio(s.text, filename)
                audio_url = f"/audio/{filename}"
                break
            except Exception as e:
                last_err = e
                print(f"[TTS] attempt {attempt + 1}/3 failed for sentence {s.id}: {e}")
                time.sleep(1)
        if not audio_url:
            # 3 次都失败：不入缓存池，下次会被淘汰/重生成
            s.is_cached = False
            print(f"[TTS] 最终失败，sentence {s.id} 不入缓存: {last_err}")
        else:
            s.audio_url = audio_url
    db.commit()
    return sentences


@router.post("/generate", response_model=SentenceGenerateResponse)
def generate_sentences(
    request: SentenceGenerateRequest,
    db: Session = Depends(get_db)
):
    """生成练习句子"""
    session_id = str(uuid.uuid4())
    cache_svc = CacheService(db)

    # 1. force_new: skip cache entirely
    if request.force_new:
        words = cache_svc.select_random_words(request.lib_id, request.count)
        if len(words) < 5:
            raise HTTPException(status_code=400, detail="词库词汇不足")
        sentences = generate_sentences_for_words(db, request.lib_id, words, request.difficulty, request.count)
        return SentenceGenerateResponse(
            session_id=session_id,
            sentences=[
                SentenceResponse(
                    id=s.id,
                    text=s.text,
                    chinese_text=s.chinese_text or '',
                    target_words=s.target_words,
                    difficulty=s.difficulty,
                    audio_url=s.audio_url,
                    is_cached=s.is_cached
                ) for s in sentences
            ]
        )

    # 2. Check cache freshness
    has_enough, stale_count = cache_svc.check_cache_freshness(
        request.lib_id, request.difficulty, request.count
    )

    if has_enough:
        cached = cache_svc.get_cached_sentences(request.lib_id, request.difficulty, request.count)
        return SentenceGenerateResponse(
            session_id=session_id,
            sentences=[
                SentenceResponse(
                    id=s.id,
                    text=s.text,
                    chinese_text=s.chinese_text or '',
                    target_words=s.target_words,
                    difficulty=s.difficulty,
                    audio_url=s.audio_url,
                    is_cached=True
                ) for s in cached
            ]
        )

    # 3. Not enough cache — determine how many new sentences needed
    deficit = request.count

    # Get existing cached sentence word coverage
    existing = (
        db.query(Sentence)
        .filter(
            Sentence.lib_id == request.lib_id,
            Sentence.difficulty == request.difficulty,
            Sentence.is_cached == True,
        )
        .all()
    )
    used_words = set()
    for s in existing:
        used_words.update(s.target_words)

    # Select NEW random words (not already in cache)
    words_to_generate = cache_svc.select_random_words(
        request.lib_id, deficit * 2, exclude_words=list(used_words)
    )
    # Actually just get deficit random words
    words = cache_svc.select_random_words(request.lib_id, deficit)

    if len(words) < 5:
        raise HTTPException(status_code=400, detail="词库词汇不足")

    # Evict if approaching storage limit
    total_cached = (
        db.query(Sentence)
        .filter(
            Sentence.lib_id == request.lib_id,
            Sentence.difficulty == request.difficulty,
            Sentence.is_cached == True,
        )
        .count()
    )
    if total_cached >= settings.cache_target_size:
        cache_svc.evict_sentences(
            request.lib_id, request.difficulty,
            batch_size=settings.cache_eviction_batch_size, dry_run=False
        )

    # Generate new sentences
    sentences = generate_sentences_for_words(db, request.lib_id, words, request.difficulty, request.count)

    return SentenceGenerateResponse(
        session_id=session_id,
        sentences=[
            SentenceResponse(
                id=s.id,
                text=s.text,
                chinese_text=s.chinese_text or '',
                target_words=s.target_words,
                difficulty=s.difficulty,
                audio_url=s.audio_url,
                is_cached=s.is_cached
            ) for s in sentences
        ]
    )


@router.post("/check", response_model=AnswerCheckResponse)
def check_answer(request: AnswerCheckRequest, db: Session = Depends(get_db)):
    """校验用户答案"""
    sentence = db.query(Sentence).filter(Sentence.id == request.sentence_id).first()
    if not sentence:
        raise HTTPException(status_code=404, detail="句子不存在")

    ai_service = get_ai_service()
    is_correct = ai_service.validate_answer(sentence.text, request.user_input)

    return AnswerCheckResponse(
        is_correct=is_correct,
        correct_answer=sentence.text
    )


@router.get("/cache/stats", response_model=CacheStatsResponse)
def get_cache_stats(
    lib_id: Optional[UUID] = Query(None),
    difficulty: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """获取缓存统计信息"""
    cache_svc = CacheService(db)
    query = db.query(Sentence).filter(Sentence.is_cached == True)

    if lib_id:
        query = query.filter(Sentence.lib_id == lib_id)
    if difficulty:
        query = query.filter(Sentence.difficulty == difficulty)

    total = query.count()
    stale = query.filter(Sentence.is_stale == True).count()
    low_use = query.filter(
        Sentence.use_count < settings.cache_min_use_count,
        Sentence.is_stale == False
    ).count()

    return CacheStatsResponse(
        total=total,
        stale=stale,
        non_stale=total - stale,
        low_use=low_use
    )


@router.post("/cache/evict", response_model=CacheEvictResponse)
def evict_cache(request: CacheEvictRequest, db: Session = Depends(get_db)):
    """触发缓存淘汰"""
    cache_svc = CacheService(db)
    evicted = cache_svc.evict_sentences(
        lib_id=request.lib_id,
        difficulty=request.difficulty,
        batch_size=settings.cache_eviction_batch_size,
        dry_run=request.dry_run
    )
    return CacheEvictResponse(evicted_count=evicted, dry_run=request.dry_run)


@router.post("/cache/refresh", response_model=dict)
def refresh_cache(db: Session = Depends(get_db)):
    """刷新过期缓存句子"""
    cache_svc = CacheService(db)
    stale_batch = cache_svc.get_stale_for_refresh(batch_size=20)
    refreshed = 0

    for sentence in stale_batch:
        words = sentence.target_words
        if not words:
            continue
        ai_svc = get_ai_service()
        try:
            generated = ai_svc.generate_sentences(words, 1)
            if generated:
                sentence.text = generated[0].get("text", sentence.text)
                sentence.chinese_text = generated[0].get("chinese_text", sentence.chinese_text)
                sentence.is_stale = False
                sentence.refresh_count += 1
                refreshed += 1
        except Exception:
            continue

    db.commit()
    return {"refreshed_count": refreshed}


@router.post("/cache/prewarm", response_model=PrewarmResponse)
def prewarm_library(request: PrewarmRequest, db: Session = Depends(get_db)):
    """预热词库的缓存"""
    cache_svc = CacheService(db)
    count = cache_svc.prewarm_library(
        request.lib_id, request.difficulty, request.target_count
    )
    return PrewarmResponse(generated_count=count)