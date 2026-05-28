#!/usr/bin/env python3
"""
词库导入脚本
将 CSV 文件导入到 PostgreSQL 数据库

使用方法:
    # 设置 DATABASE_URL 环境变量
    export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
    python scripts/seed_vocabulary.py
"""

import os
import csv
import uuid
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# 词库等级映射
LEVELS = {
    'beginner': '初中基础词汇',
    'cet4': '大学英语四级',
    'cet6': '大学英语六级',
    'ielts': '雅思进阶词汇'
}


def get_database_url():
    """获取数据库 URL"""
    # 优先使用环境变量
    db_url = os.getenv('DATABASE_URL')
    if db_url:
        return db_url

    # 从独立环境变量构建
    user = os.getenv('POSTGRES_USER', 'english_user')
    password = os.getenv('POSTGRES_PASSWORD', 'password')
    host = os.getenv('POSTGRES_HOST', 'localhost')
    port = os.getenv('POSTGRES_PORT', '5432')
    dbname = os.getenv('POSTGRES_DB', 'english_learning')

    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def create_tables(engine):
    """创建表结构"""
    from sqlalchemy import text

    with engine.connect() as conn:
        # 创建 vocabulary_libs 表
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vocabulary_libs (
                id UUID PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                level VARCHAR(20) NOT NULL,
                word_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 创建 vocabulary_words 表
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vocabulary_words (
                id UUID PRIMARY KEY,
                lib_id UUID REFERENCES vocabulary_libs(id) ON DELETE CASCADE,
                word VARCHAR(100) NOT NULL,
                phonetic VARCHAR(100) DEFAULT '',
                translation TEXT DEFAULT '',
                part_of_speech VARCHAR(20) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 创建 sentences 表
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sentences (
                id UUID PRIMARY KEY,
                lib_id UUID REFERENCES vocabulary_libs(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                target_words TEXT[],
                difficulty VARCHAR(20) DEFAULT 'beginner',
                audio_url VARCHAR(500) DEFAULT '',
                is_cached BOOLEAN DEFAULT TRUE,
                use_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.commit()
        print("数据库表创建完成")


def import_vocabulary(engine, csv_dir: str):
    """导入词库"""
    from sqlalchemy import text

    Session = sessionmaker(bind=engine)
    session = Session()

    total_words = 0

    for level, lib_name in LEVELS.items():
        csv_path = os.path.join(csv_dir, f'{level}.csv')

        if not os.path.exists(csv_path):
            print(f"警告: {csv_path} 不存在，跳过")
            continue

        # 检查词库是否已存在
        existing = session.execute(
            text("SELECT id FROM vocabulary_libs WHERE level = :level"),
            {'level': level}
        ).fetchone()

        if existing:
            print(f"词库 {lib_name} 已存在，跳过导入")
            continue

        # 创建词库
        lib_id = str(uuid.uuid4())
        session.execute(
            text("""
                INSERT INTO vocabulary_libs (id, name, level, word_count, created_at)
                VALUES (:id, :name, :level, :word_count, :created_at)
            """),
            {
                'id': lib_id,
                'name': lib_name,
                'level': level,
                'word_count': 0,
                'created_at': datetime.utcnow()
            }
        )

        # 读取并导入词汇
        word_count = 0
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row.get('word', '').strip():
                    continue

                word_id = str(uuid.uuid4())
                session.execute(
                    text("""
                        INSERT INTO vocabulary_words
                        (id, lib_id, word, phonetic, translation, part_of_speech, created_at)
                        VALUES (:id, :lib_id, :word, :phonetic, :translation, :part_of_speech, :created_at)
                    """),
                    {
                        'id': word_id,
                        'lib_id': lib_id,
                        'word': row.get('word', '').strip().lower(),
                        'phonetic': row.get('phonetic', ''),
                        'translation': row.get('translation', ''),
                        'part_of_speech': row.get('part_of_speech', ''),
                        'created_at': datetime.utcnow()
                    }
                )
                word_count += 1

        # 更新词库词汇数量
        session.execute(
            text("UPDATE vocabulary_libs SET word_count = :count WHERE id = :id"),
            {'count': word_count, 'id': lib_id}
        )

        total_words += word_count
        print(f"导入 {lib_name}: {word_count} 词汇")

    session.commit()
    session.close()

    return total_words


def main():
    print("=" * 50)
    print("词库导入工具")
    print("=" * 50)
    print()

    # 获取数据库 URL
    db_url = get_database_url()
    print(f"数据库: {db_url.split('@')[1] if '@' in db_url else 'localhost'}")
    print()

    # 创建引擎
    engine = create_engine(db_url)

    # CSV 目录
    csv_dir = os.path.join(os.path.dirname(__file__), '..', 'seed', 'vocabulary')

    if not os.path.exists(csv_dir):
        print(f"错误: 词库目录不存在: {csv_dir}")
        print("请先运行 python scripts/generate_vocab.py 生成词库")
        return

    # 创建表
    print("创建数据库表...")
    create_tables(engine)
    print()

    # 导入词库
    print("导入词库...")
    total = import_vocabulary(engine, csv_dir)
    print()
    print("=" * 50)
    print(f"导入完成! 共导入 {total} 个词汇")
    print("=" * 50)


if __name__ == '__main__':
    main()
