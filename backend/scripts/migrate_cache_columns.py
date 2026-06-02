"""
Migration: Add cache-related columns to sentences table.
Run once after deploying the cache-first feature.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine, SessionLocal


def migrate():
    with engine.connect() as conn:
        # Check if columns exist
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'sentences' AND column_name = 'last_used_at'
        """))
        if result.fetchone() is None:
            print("Adding last_used_at column...")
            conn.execute(text("ALTER TABLE sentences ADD COLUMN last_used_at TIMESTAMP DEFAULT NOW()"))
            conn.commit()

        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'sentences' AND column_name = 'is_stale'
        """))
        if result.fetchone() is None:
            print("Adding is_stale column...")
            conn.execute(text("ALTER TABLE sentences ADD COLUMN is_stale BOOLEAN DEFAULT FALSE"))
            conn.commit()

        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'sentences' AND column_name = 'refresh_count'
        """))
        if result.fetchone() is None:
            print("Adding refresh_count column...")
            conn.execute(text("ALTER TABLE sentences ADD COLUMN refresh_count INTEGER DEFAULT 0"))
            conn.commit()

        print("Migration complete.")


if __name__ == "__main__":
    migrate()