"""
type-any-language backend — pure read-layer.

The runtime is intentionally minimal: serve cached vocabulary, words, and
pre-generated sentences that the CMS host baked into the db image. No AI,
no TTS, no scheduler — those run at bake time on the CMS host.

Why this is so thin:
  - Content (vocab_libs, vocab_words, sentences) ships inside the db image.
  - Schema is created at bake time (db/init/01-content.sql).
  - Audio is served directly from Tencent Cloud COS via the
    sentences.audio_url column (full URL stored at bake time). The backend
    exposes no /audio endpoint — the frontend reads sentence.audio_url
    and the browser streams from COS.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.routers import content, lessons, sentences, vocabulary, auth

settings = get_settings()

# Schema is owned by the baked db image (db/init/01-content.sql).
# create_all() is a safety net for tests / when running against an empty
# DB — it never alters an existing table.
Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="type-any-language API",
    version="0.1.0",
    description=(
        "Read-layer API over the content-baked db image. "
        "No AI/TTS calls happen here — those are baked in at build time. "
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