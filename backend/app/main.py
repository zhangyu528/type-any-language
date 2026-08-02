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
    dashboard,
    lessons,
    practice_session,
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
def verify_schema_up_to_date() -> None:
    """Fail-fast at boot when the database schema is behind the latest
    migration shipped in this image.

    Default: ENABLED. Set STRICT_MIGRATIONS=0 to opt out (dev workflow
    that hot-reloads schema changes without rebooting; CI tests where
    the runner does migrations itself before importing app.main).

    What it checks:
      - get_current_version() reads `schema_migrations.version`. We
        compare it against the highest version discovered under
        migrations/versions/.
      - The check runs ONLY against the schema version table — we do
        NOT introspect every column. That's the migration runner's
        contract: applying a migration is the source of truth, and the
        bookkeeping table records it.
      - Rerunnable migrations (0007 / 0008 / 0011) are NOT applied here.
        The check is "is the bookkeeping stamped at the latest version";
        rerunnable's idempotent upgrade() runs from `migrate.sh`, not
        from boot. So a fresh-import workflow needs:
            ./db/scripts/migrate.sh && ./ops/dev/native.sh start
        not the other order — otherwise this check fires.

    Failure modes:
      - DATABASE_URL unset / db unreachable → bubble up. A backend
        that can't reach its db can't serve traffic; we shouldn't
        pretend /health is OK and silently 5xx the real routes.
      - schema_migrations table missing → get_current_version() returns
        None, which is != latest → fail-fast. This is the right answer
        for a freshly-created db: it needs migrate.sh, not create_all.

    Why not just run upgrade_head() at boot:
      - Multiple backend replicas could race on the schema_migrations
        INSERT (PK conflict).
      - Long-running migrations (table rewrites) would block boot and
        cause cascading health-check failures.
      - The migration owner is the operator / CI, not the application.
        Keeping that boundary explicit matches the project's
        "host-side runner, no sidecar container" rule.

    Set STRICT_MIGRATIONS=0 to disable.
    """
    if os.getenv("STRICT_MIGRATIONS", "1") == "0":
        return

    import psycopg2

    from migrations.runner import (
        _discover_versions,
        ensure_schema_migrations_table,
        get_current_version,
    )

    db_url = settings.resolved_database_url()
    try:
        with psycopg2.connect(db_url) as conn:
            ensure_schema_migrations_table(conn)
            current = get_current_version(conn)
    except Exception as exc:
        raise RuntimeError(
            f"[startup] cannot verify schema: failed to connect to "
            f"the database ({type(exc).__name__}: {exc}). "
            f"Check DATABASE_URL / docker-compose / cloud status."
        ) from exc

    known = _discover_versions()
    if not known:
        # No migrations shipped (shouldn't happen in this repo) — skip.
        return
    latest = known[-1].version

    if current is None:
        raise RuntimeError(
            f"[startup] schema not initialised (schema_migrations is empty). "
            f"Latest known version is {latest!r}. "
            f"Run: ./db/scripts/migrate.sh"
        )
    if current != latest:
        # Compute the gap so the operator can see what's pending.
        pending = [m.version for m in known if m.version > current]
        raise RuntimeError(
            f"[startup] schema is behind the image: "
            f"db has {current!r}, latest is {latest!r}. "
            f"Pending: {', '.join(pending)}. "
            f"Run: ./db/scripts/migrate.sh"
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
app.include_router(dashboard.router)
app.include_router(practice_session.router)


@app.get("/")
def root():
    return {"message": "type-any-language API v0.1.0", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}