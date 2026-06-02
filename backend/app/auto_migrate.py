"""
Auto-migrate: Add missing columns to existing tables.
Safe to run multiple times — checks before altering.
"""
from sqlalchemy import text
from app.database import engine


def run_auto_migrate():
    """Check and add missing columns on startup."""
    with engine.connect() as conn:
        migrations = [
            ("last_used_at", "ALTER TABLE sentences ADD COLUMN last_used_at TIMESTAMP DEFAULT NOW()"),
            ("is_stale", "ALTER TABLE sentences ADD COLUMN is_stale BOOLEAN DEFAULT FALSE"),
            ("refresh_count", "ALTER TABLE sentences ADD COLUMN refresh_count INTEGER DEFAULT 0"),
        ]

        for col_name, alter_sql in migrations:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'sentences' AND column_name = :col_name
            """), {"col_name": col_name})
            if result.fetchone() is None:
                print(f"[AutoMigrate] Adding column: {col_name}")
                conn.execute(text(alter_sql))
                conn.commit()
            else:
                print(f"[AutoMigrate] Column {col_name} already exists, skipping.")