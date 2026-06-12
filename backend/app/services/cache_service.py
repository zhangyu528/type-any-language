import random
from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.sentence import Sentence
from app.models.vocabulary import VocabularyWord

settings = get_settings()


class CacheService:
    def __init__(self, db: Session):
        self.db = db

    def select_random_words(
        self, lib_id: UUID, count: int, exclude_words: Optional[List[str]] = None
    ) -> List[str]:
        """Randomly sample words from vocabulary library."""
        query = self.db.query(VocabularyWord).filter(VocabularyWord.lib_id == lib_id)
        if exclude_words:
            query = query.filter(~VocabularyWord.word.in_(exclude_words))
        words = query.all()
        if len(words) <= count:
            return [w.word for w in words]
        return random.sample([w.word for w in words], count)

    def get_cached_sentences(
        self, lib_id: UUID, difficulty: str, count: int
    ) -> List[Sentence]:
        """Serve non-stale cached sentences, update last_used_at and use_count."""
        cached = (
            self.db.query(Sentence)
            .filter(
                Sentence.lib_id == lib_id,
                Sentence.difficulty == difficulty,
                Sentence.is_cached == True,
                Sentence.is_stale == False,
                Sentence.audio_url != "",  # 兜底：排除历史脏数据
            )
            .order_by(Sentence.use_count)
            .limit(count)
            .all()
        )
        for s in cached:
            s.last_used_at = datetime.utcnow()
            s.use_count += 1
        self.db.commit()
        return cached

    def check_cache_freshness(
        self, lib_id: UUID, difficulty: str, count: int
    ) -> Tuple[bool, int]:
        """Check if enough non-stale cached sentences exist. Returns (has_enough, stale_count)."""
        total = (
            self.db.query(Sentence)
            .filter(
                Sentence.lib_id == lib_id,
                Sentence.difficulty == difficulty,
                Sentence.is_cached == True,
            )
            .count()
        )
        stale = (
            self.db.query(Sentence)
            .filter(
                Sentence.lib_id == lib_id,
                Sentence.difficulty == difficulty,
                Sentence.is_cached == True,
                Sentence.is_stale == True,
            )
            .count()
        )
        non_stale = total - stale
        return (non_stale >= count, stale)

    def evict_sentences(
        self,
        lib_id: Optional[UUID] = None,
        difficulty: Optional[str] = None,
        batch_size: Optional[int] = None,
        dry_run: bool = True,
    ) -> int:
        """Evict sentences by priority: stale > low_use+old > LRU. Returns count evicted."""
        if batch_size is None:
            batch_size = settings.cache_eviction_batch_size

        query = self.db.query(Sentence).filter(Sentence.is_cached == True)

        if lib_id:
            query = query.filter(Sentence.lib_id == lib_id)
        if difficulty:
            query = query.filter(Sentence.difficulty == difficulty)

        # Priority 1: stale sentences (oldest first by created_at)
        stale_sub = (
            query.filter(Sentence.is_stale == True)
            .order_by(Sentence.created_at)
            .limit(batch_size)
        )
        stale_ids = [s.id for s in stale_sub.all()]

        remaining = batch_size - len(stale_ids)
        evicted = 0

        if remaining > 0 and len(stale_ids) < batch_size:
            # Priority 2: low use_count + age > 7 days
            cutoff_date = datetime.utcnow() - timedelta(days=7)
            low_use_sub = (
                query.filter(
                    Sentence.is_stale == False,
                    Sentence.use_count < settings.cache_min_use_count,
                    Sentence.created_at < cutoff_date,
                )
                .order_by(Sentence.use_count, Sentence.created_at)
                .limit(remaining)
            )
            low_use_ids = [s.id for s in low_use_sub.all()]
            stale_ids.extend(low_use_ids)

        if dry_run:
            return len(stale_ids)

        for sid in stale_ids:
            self.db.delete(self.db.query(Sentence).filter(Sentence.id == sid).first())
        self.db.commit()
        return len(stale_ids)

    def mark_stale_sentences(self, max_age_days: Optional[int] = None) -> int:
        """Mark sentences older than max_age_days as stale. Returns count marked."""
        if max_age_days is None:
            max_age_days = settings.cache_max_age_days

        cutoff = datetime.utcnow() - timedelta(days=max_age_days)
        updated = (
            self.db.query(Sentence)
            .filter(
                Sentence.is_cached == True,
                Sentence.is_stale == False,
                Sentence.created_at < cutoff,
            )
            .update({"is_stale": True}, synchronize_session=False)
        )
        self.db.commit()
        return updated

    def prewarm_library(
        self, lib_id: UUID, difficulty: str = "beginner", target_count: int = 50
    ) -> int:
        """Ensure at least target_count cached sentences exist for lib+difficulty."""
        from app.services.ai_service import get_ai_service

        current = (
            self.db.query(Sentence)
            .filter(
                Sentence.lib_id == lib_id,
                Sentence.difficulty == difficulty,
                Sentence.is_cached == True,
            )
            .count()
        )

        if current >= target_count:
            return 0

        deficit = target_count - current
        ai_svc = get_ai_service()

        # Get words not yet used in cache for this lib+difficulty
        existing_sentences = (
            self.db.query(Sentence)
            .filter(
                Sentence.lib_id == lib_id,
                Sentence.difficulty == difficulty,
                Sentence.is_cached == True,
            )
            .all()
        )
        used_words = set()
        for s in existing_sentences:
            used_words.update(s.target_words)

        generated_count = 0
        batch_size = min(deficit, 10)

        for _ in range((deficit + batch_size - 1) // batch_size):
            words = self.select_random_words(lib_id, batch_size, exclude_words=list(used_words))
            if not words:
                words = self.select_random_words(lib_id, batch_size)

            try:
                generated = ai_svc.generate_sentences(words, batch_size)
            except Exception:
                continue

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
                self.db.add(sentence)
                used_words.update(target_words)
                generated_count += 1

        self.db.commit()
        return generated_count

    def get_stale_for_refresh(self, batch_size: int = 100) -> List[Sentence]:
        """Return stale sentences for background regeneration."""
        return (
            self.db.query(Sentence)
            .filter(Sentence.is_stale == True, Sentence.is_cached == True)
            .order_by(Sentence.created_at)
            .limit(batch_size)
            .all()
        )


def get_cache_service(db: Session) -> CacheService:
    return CacheService(db)