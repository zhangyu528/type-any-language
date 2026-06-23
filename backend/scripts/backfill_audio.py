#!/usr/bin/env python3
"""
为 audio_url 为空的 sentence 补生成 TTS 音频并写回 DB。

- 幂等：audio_url 已非空则跳过
- 失败：打印 WARN，跳过（不删除行），让后续修复或重跑处理

使用方法:
    export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
    # 需要在 backend 目录下执行（依赖 app.services.tts_service）
    cd backend
    python scripts/backfill_audio.py
"""
import os
import sys
from pathlib import Path

# 让脚本能找到 app 包
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.sentence import Sentence  # noqa: F401  (import order matters: VocabularyLib must be registered first)
from app.models.vocabulary import VocabularyLib  # noqa: F401
from app.services.tts_service import generate_audio, text_to_audio_filename


def get_database_url() -> str:
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        return db_url
    user = os.getenv("POSTGRES_USER", "english_user")
    password = os.getenv("POSTGRES_PASSWORD", "password")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    dbname = os.getenv("POSTGRES_DB", "english_learning")
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def main():
    db_url = get_database_url()
    print(f"[backfill] DB: {db_url.split('@')[-1]}")  # 不打印密码

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        rows = (
            session.query(Sentence)
            .filter((Sentence.audio_url == "") | (Sentence.audio_url.is_(None)))
            .all()
        )
        total = len(rows)
        print(f"[backfill] 找到 {total} 条 audio_url 为空的 sentence")

        success = 0
        failed = 0
        for s in rows:
            try:
                filename = text_to_audio_filename(s.text)
                generate_audio(s.text, filename)
                s.audio_url = f"/audio/{filename}"
                success += 1
                print(f"[backfill] OK   {s.id} -> /audio/{filename}")
            except Exception as e:
                failed += 1
                print(f"[backfill] FAIL {s.id}: {type(e).__name__}: {e}")

        session.commit()
        print(f"[backfill] 完成：成功 {success} / 失败 {failed} / 总计 {total}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
