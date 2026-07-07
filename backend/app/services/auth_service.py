"""
Auth service — password hashing + JWT signing / decoding.

Stateless JWT design:
  - Tokens carry the user_id (`sub` claim) and an `exp` timestamp.
  - The backend does NOT store issued tokens in the database — the
    signed token IS the session, verifiable with the secret alone.
  - Trade-off: revoking a single token before expiry requires either
    rotating the JWT_SECRET (logs out everyone) or maintaining a
    denylist (out of scope for v1).

Password hashing:
  - passlib + bcrypt. bcrypt has a 72-byte input cap (silent truncation
    beyond that). SignupRequest schema enforces max_length=72, so the
    boundary is correct.
  - `bcrypt==4.0.1` is pinned because passlib 1.7.4 doesn't support
    bcrypt 4.1+ internals.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import jwt
from passlib.context import CryptContext

from app.config import get_settings


_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Password
# ---------------------------------------------------------------------------
def hash_password(plain: str) -> str:
    """Hash a plaintext password using bcrypt. Output is a $2b$ string
    ~60 chars long. Idempotency-irrelevant — each call yields a fresh
    salt, so the same plaintext never hashes to the same string."""
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time verification. Returns False on malformed hash."""
    try:
        return _pwd.verify(plain, hashed)
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
def create_access_token(user_id: UUID | str) -> tuple[str, int]:
    """Sign a JWT for the given user. Returns (token, expires_in_seconds).

    `expires_in` is the same value the cookie's `max_age` should use, so
    frontend code can show "session expires in X" without re-decoding
    the token (which would require the secret).
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_in = settings.JWT_EXPIRES_DAYS * 24 * 60 * 60
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.JWT_EXPIRES_DAYS)).timestamp()),
    }
    token = jwt.encode(
        payload,
        settings.resolved_jwt_secret(),
        algorithm=settings.JWT_ALGORITHM,
    )
    return token, expires_in


def decode_token(token: str) -> dict[str, Any]:
    """Verify signature + expiry and return the JWT payload.

    Raises jwt.ExpiredSignatureError / jwt.InvalidTokenError on failure.
    Callers (deps/auth.py) translate these to 401.
    """
    settings = get_settings()
    return jwt.decode(
        token,
        settings.resolved_jwt_secret(),
        algorithms=[settings.JWT_ALGORITHM],
    )


# ---------------------------------------------------------------------------
# Cookie
# ---------------------------------------------------------------------------
# Single source of truth for the cookie name. Chosen as `tal_session`
# (`type-any-language` abbreviated) to avoid clashing with any future
# framework-defined cookie (`session`, `sessionid`, etc.).
COOKIE_NAME = "tal_session"


def cookie_max_age() -> int:
    """Cookie max_age in seconds — mirrors JWT expiry."""
    return get_settings().JWT_EXPIRES_DAYS * 24 * 60 * 60