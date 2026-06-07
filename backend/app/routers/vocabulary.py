from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
import random

from app.database import get_db
from app.models.vocabulary import VocabularyLib, VocabularyWord
from app.schemas.vocabulary import VocabularyLibResponse, VocabularyWordResponse
from app.services.phonetics_service import get_phonetic_for_words

router = APIRouter(prefix="/api/vocabulary", tags=["vocabulary"])


@router.get("/libs", response_model=List[VocabularyLibResponse])
def get_all_libs(db: Session = Depends(get_db)):
    """获取所有词库列表"""
    libs = db.query(VocabularyLib).all()
    return libs


@router.get("/libs/{lib_id}", response_model=VocabularyLibResponse)
def get_lib(lib_id: UUID, db: Session = Depends(get_db)):
    """获取词库详情"""
    lib = db.query(VocabularyLib).filter(VocabularyLib.id == lib_id).first()
    if not lib:
        raise HTTPException(status_code=404, detail="词库不存在")
    return lib


@router.get("/libs/{lib_id}/words", response_model=List[VocabularyWordResponse])
def get_lib_words(lib_id: UUID, db: Session = Depends(get_db)):
    """获取词库中的所有词汇"""
    words = db.query(VocabularyWord).filter(VocabularyWord.lib_id == lib_id).all()
    return words


@router.get("/libs/{lib_id}/random", response_model=List[VocabularyWordResponse])
def get_random_words(lib_id: UUID, n: int = 20, db: Session = Depends(get_db)):
    """随机获取 n 个词汇"""
    words = db.query(VocabularyWord).filter(VocabularyWord.lib_id == lib_id).all()
    if len(words) <= n:
        return words
    return random.sample(words, n)


@router.get("/phonetics")
def get_phonetics(
    words: str = Query(..., description="Comma-separated word list"),
    db: Session = Depends(get_db),
):
    """
    批量查询单词音标。优先查 vocabulary_words 表，没有则 fallback 到 CMUdict。
    返回 {word: phonetic}（只包含找到的）。
    """
    word_list = [w.strip() for w in words.split(",") if w.strip()]
    if not word_list:
        return {}

    # Step 1: try vocabulary_words table
    vocab_lookup: dict[str, str] = {}
    lower_words = [w.lower() for w in word_list]
    rows = (
        db.query(VocabularyWord)
        .filter(VocabularyWord.word.in_(lower_words))
        .filter(VocabularyWord.phonetic.isnot(None), VocabularyWord.phonetic != "")
        .all()
    )
    for row in rows:
        vocab_lookup[row.word.lower()] = row.phonetic

    # Step 2: resolve with CMUdict fallback
    return get_phonetic_for_words(word_list, vocab_lookup)
