import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
import os

from app.database import get_db
from app.models.vocabulary import VocabularyWord
from app.models.sentence import Sentence
from app.schemas.sentence import (
    SentenceGenerateRequest,
    SentenceGenerateResponse,
    SentenceResponse,
    AnswerCheckRequest,
    AnswerCheckResponse
)
from app.services.ai_service import get_ai_service
from app.services.tts_service import get_tts_service
from app.config import get_settings

router = APIRouter(prefix="/api/sentences", tags=["sentences"])
settings = get_settings()


@router.post("/generate", response_model=SentenceGenerateResponse)
def generate_sentences(
    request: SentenceGenerateRequest,
    db: Session = Depends(get_db)
):
    """生成练习句子"""
    session_id = str(uuid.uuid4())

    # 1. 尝试从缓存获取
    if not request.force_new:
        cached = (
            db.query(Sentence)
            .filter(
                Sentence.lib_id == request.lib_id,
                Sentence.difficulty == request.difficulty,
                Sentence.is_cached == True
            )
            .order_by(Sentence.use_count)
            .limit(request.count)
            .all()
        )

        if len(cached) >= request.count:
            # 更新使用次数
            for s in cached:
                s.use_count += 1
            db.commit()

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

    # 2. 需要生成新句子
    # 获取随机词汇
    words = (
        db.query(VocabularyWord)
        .filter(VocabularyWord.lib_id == request.lib_id)
        .all()
    )

    if len(words) < 5:
        raise HTTPException(status_code=400, detail="词库词汇不足")

    # 随机选择词汇
    selected_words = [w.word for w in words[:min(10, len(words))]]

    # 调用 AI 生成句子
    ai_service = get_ai_service()
    try:
        generated = ai_service.generate_sentences(selected_words, request.count)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {str(e)}")

    # 3. 生成音频并保存
    tts_service = get_tts_service()
    sentences = []

    for item in generated:
        text = item.get("text", "")
        chinese_text = item.get("chinese_text", "")
        target_words = item.get("target_words", [])

        if not text:
            continue

        # 生成音频
        try:
            audio_url = tts_service.generate_audio(text)
        except Exception:
            audio_url = ""

        # 保存到数据库
        sentence = Sentence(
            lib_id=request.lib_id,
            text=text,
            chinese_text=chinese_text,
            target_words=target_words,
            difficulty=request.difficulty,
            audio_url=audio_url,
            is_cached=True,
            use_count=1
        )
        db.add(sentence)
        sentences.append(sentence)

    db.commit()

    # 刷新获取 ID
    for s in sentences:
        db.refresh(s)

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


@router.get("/{sentence_id}/audio")
def get_audio(sentence_id: uuid.UUID, db: Session = Depends(get_db)):
    """获取句子音频"""
    sentence = db.query(Sentence).filter(Sentence.id == sentence_id).first()
    if not sentence:
        raise HTTPException(status_code=404, detail="句子不存在")

    if not sentence.audio_url:
        raise HTTPException(status_code=404, detail="音频不存在")

    # 构建音频文件路径
    filename = os.path.basename(sentence.audio_url)
    filepath = os.path.join(settings.audio_dir, filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="音频文件不存在")

    return FileResponse(
        filepath,
        media_type="audio/wav",
        filename=filename
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
