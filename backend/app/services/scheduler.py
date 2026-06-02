from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.config import get_settings
from app.services.cache_service import CacheService

settings = get_settings()
scheduler = AsyncIOScheduler()


def mark_stale_task():
    """Mark old sentences as stale (runs every 6 hours)."""
    db = SessionLocal()
    try:
        cache_svc = CacheService(db)
        marked = cache_svc.mark_stale_sentences(max_age_days=settings.cache_max_age_days)
        print(f"[Scheduler] Marked {marked} sentences as stale")
    finally:
        db.close()


def prewarm_priority_task():
    """Pre-warm high-priority libraries (runs daily at 3am)."""
    from app.models.vocabulary import VocabularyLib
    db = SessionLocal()
    try:
        cache_svc = CacheService(db)
        libs = db.query(VocabularyLib).all()
        for lib in libs:
            cache_svc.prewarm_library(lib.id, difficulty="beginner", target_count=settings.cache_target_size)
            print(f"[Scheduler] Pre-warmed library {lib.id} ({lib.name})")
    finally:
        db.close()


def setup_periodic_tasks():
    """Register all periodic jobs."""
    # Every 6 hours: mark old sentences as stale
    scheduler.add_job(mark_stale_task, trigger=IntervalTrigger(hours=6), id="mark_stale")

    # Daily at 3am: pre-warm all libraries
    scheduler.add_job(prewarm_priority_task, trigger=CronTrigger(hour=3), id="prewarm_priority")


def start_scheduler():
    setup_periodic_tasks()
    scheduler.start()
    print("[Scheduler] Started")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("[Scheduler] Stopped")