"""
type-any-language backend — pure read-layer.

The runtime is intentionally minimal: serve cached vocabulary, words, and
pre-generated sentences that the CMS host baked into the db image. No AI,
no TTS, no scheduler — those run at bake time on the CMS host.

Why this is so thin:
  - Content (vocab_libs, vocab_words, sentences) ships inside the db image.
  - Schema is created at bake time (db/init/01-content.sql).
  - The backend only mounts the static audio dir and exposes GET endpoints.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import engine, Base
from app.routers import content, sentences, vocabulary, auth, me

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
        "No AI/TTS calls happen here — those are baked in at build time."
    ),
)

# Serve MP3s from the shared-audio volume that the db image seeds.
# Mount is conditional — when running tests or in non-docker contexts
# where /audio doesn't exist (read-only host fs on macOS), skip the
# mount so the app doesn't crash on import. The audio volume is only
# meaningful in the compose runtime; in tests we never hit /audio/*.
import os as _os
if _os.path.isdir("/audio"):
    app.mount("/audio", StaticFiles(directory="/audio"), name="audio")

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
app.include_router(auth.router)
app.include_router(me.router)


@app.get("/")
def root():
    return {"message": "type-any-language API v0.1.0", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}