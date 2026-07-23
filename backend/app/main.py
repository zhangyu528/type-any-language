"""
type-any-language backend — pure read-layer.

The runtime is intentionally minimal: serve cached vocabulary, words, and
pre-generated sentences that the CMS host wrote into the cloud db. No AI,
no TTS, no scheduler — those run on the CMS host.

Why this is so thin:
  - Content (vocab_libs, vocab_words, sentences) lives in TencentDB.
  - Schema is owned by backend/init_schema.py + migrations.
  - Audio is served directly from Tencent Cloud COS via the
    sentences.audio_url column (full URL stored when the CMS audio step
    ran). The backend exposes no /audio endpoint — the frontend reads
    sentence.audio_url and the browser streams from COS.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.routers import content, lessons, sentences, vocabulary, auth

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
)

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


@app.get("/")
def root():
    return {"message": "type-any-language API v0.1.0", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}