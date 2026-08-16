"""
type-any-language backend — pure read-layer.

The runtime is intentionally minimal: serve cached vocabulary, words, and
pre-generated sentences that the CMS host wrote into the docker postgres. No AI,
no TTS, no scheduler — those run on the CMS host.

Why this is so thin:
  - Content (vocab_libs, vocab_words, sentences) lives in docker postgres.
  - Schema is owned by backend/init_schema.py + migrations.
  - Audio is served directly from Tencent Cloud COS via the
    sentences.audio_url column (full URL stored when the CMS audio step
    ran). The backend exposes no /audio endpoint — the frontend reads
    sentence.audio_url and the browser streams from COS.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.routers import (
    auth,
    content,
    courses,
    dashboard,
    favorites,
    lessons,
    practice_session,
    review,
    sentences,
    vocabulary,
)

settings = get_settings()

# Schema is owned by backend/init_schema.py + migrations/. create_all()
# is a safety net for tests / when running against an empty DB — it never
# alters an existing table.
Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="type-any-language API",
    version="0.1.0",
    description=(
        "Read-layer API over the cloud Postgres. "
        "No AI/TTS calls happen here — those ran on the CMS host. "
        "Audio is served from Tencent Cloud COS via sentences.audio_url."
    ),
    # Don't suppress startup exceptions by default — we want
    # STRICT_MIGRATIONS to abort the boot, not silently 200 /health.
    # This flag only affects exception handlers installed by Starlette;
    # raising from the startup event still aborts. The flag is here
    # for future "soft" failure modes if we ever want them.
)


@app.on_event("startup")
def verify_db_reachable() -> None:
    """Sanity-check db connection at boot. Fails fast if db is unreachable.

    Schema migrations are applied by backend/image-entrypoint.sh on
    every container start, idempotently (runner stamps applied versions
    in schema_migrations). Content import runs in db/image-entrypoint.sh.
    By the time this startup event fires, the entrypoint has already
    finished migrations and exec'd into uvicorn, so the schema is
    guaranteed current. The check below is just a "can I open a
    connection?" probe — fails fast with a clear error if db is
    somehow unreachable, rather than serving 500s on every request.
    """
    db_url = settings.resolved_database_url()
    try:
        import psycopg2
        with psycopg2.connect(db_url) as conn:
            # Just open + close — the connection itself is the proof
            # of life. Migrations are not re-checked here (entrypoint
            # already stamped them) and content import isn't either
            # (db's entrypoint handles that).
            pass
    except Exception as exc:
        raise RuntimeError(
            f"[startup] cannot reach db ({type(exc).__name__}: {exc}). "
            f"Check that the db service is running and DATABASE_URL is correct."
        ) from exc


# Note: previous `verify_schema_up_to_date` removed. With Layer 3
# (custom db image with migrations + content baked in, see
# db/Dockerfile + db/image-entrypoint.sh), the db image's entrypoint
# is now the source of truth for schema state. The backend just
# sanity-checks connectivity at boot via `verify_db_reachable` above.


# CORS allowlist — comes from app.config (env ALLOWED_ORIGINS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vocabulary.router)
app.include_router(sentences.router)
app.include_router(content.router)
app.include_router(lessons.router)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(practice_session.router)
app.include_router(favorites.router)
app.include_router(review.router)
app.include_router(courses.router)


@app.get("/")
def root():
    return {"message": "type-any-language API v0.1.0", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}