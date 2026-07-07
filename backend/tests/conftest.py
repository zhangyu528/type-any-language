"""
Pytest fixtures for backend tests.

Strategy:
  - Hit the actual dev DB (the one resolved from DATABASE_URL_FILE /
    DATABASE_URL). The whole project's runtime contract is that the
    backend speaks SQL to that one DB, so testing against anything else
    would be lying about what we're verifying.
  - Isolate each test with a SAVEPOINT pattern: open a connection,
    begin an outer transaction, then begin a nested SAVEPOINT that the
    app's commits release without ever leaving the connection. On
    teardown we rollback the outer transaction → zero side effects.
  - Override the FastAPI `get_db` dependency so every endpoint in the
    test uses the same connection-bound session.

JWT_SECRET must be set BEFORE the app imports — get_settings() is
cached at module load time. We provide a deterministic test secret.
"""
from __future__ import annotations

import os

# IMPORTANT: set this BEFORE importing anything from app.*
os.environ.setdefault(
    "JWT_SECRET",
    "test-secret-key-for-unit-tests-only-do-not-use-in-prod-aabbccdd",
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.main import app
from app.database import get_db
from app.config import get_settings


settings = get_settings()
engine = create_engine(
    settings.resolved_database_url(),
    poolclass=NullPool,  # no pooling — each test gets a fresh connection
)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture
def db_session():
    """Transaction-isolated session per test.

    The SAVEPOINT pattern means application-level `db.commit()` calls
    (inside endpoint handlers) release the nested savepoint but stay
    inside the outer transaction — at teardown we rollback the outer
    transaction and everything vanishes.
    """
    connection = engine.connect()
    outer = connection.begin()
    nested = connection.begin_nested()

    session = TestingSessionLocal(bind=connection)

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, trans):
        nonlocal nested
        if not nested.is_active:
            nested = connection.begin_nested()

    try:
        yield session
    finally:
        session.close()
        if outer.is_active:
            outer.rollback()
        connection.close()


@pytest.fixture
def client(db_session):
    """TestClient with `get_db` overridden to use the test session.

    All cookies set by the server during the test are remembered in
    the client's cookie jar — chained requests (signup → me) Just Work.
    """
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()