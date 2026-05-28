from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
import random

from app.database import get_db
from app.models.vocabulary import VocabularyLib, VocabularyWord
from app.schemas.vocabulary import VocabularyLibResponse, VocabularyWordResponse

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
