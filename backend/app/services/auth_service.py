"""
Auth service — bcrypt password hashing + session token lifecycle.

Why a service module instead of inline router logic:
  - Hashing parameters (rounds, pepper) are security decisions; isolating
    them here means future tweaks (argon2 migration, pepper rotation)
    don't touch the routers.
  - Session creation/lookup is the same 3 lines everywhere; one helper
    beats copy-paste.
  - The User / Session models are SQLAlchemy; this service wraps them
    in domain operations (signup, authenticate, issue_session,
    resolve_session) that the routers consume.

Password rules (frontend mirrors these in calcPasswordStrength):
  - 8-72 characters (bcrypt's 72-byte input cap)
  - No complexity requirement at v1 — length is the floor, strength
    meter nudges users toward better. NIST 800-63B agrees.

Session rules:
  - 30-day expiry from issue
  - Server stores sha256(token), client gets the raw token in a
    HttpOnly + Secure + SameSite=Lax cookie named "tal_session"
  - last_seen_at updates on every authenticated request (lets us
    expire idle sessions in a future cleanup sweep)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import bcrypt
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models.user import (
    User,
    Session,
    generate_session_token,
    hash_session_token,
)


# ---- Password hashing -----------------------------------------------------
# 12 rounds = ~250ms on a modern CPU. Bump to 13-14 if the host gets
# faster; drop to 10 only if login latency is user-visible.
_BCRYPT_ROUNDS = 12

# 30 days — long enough to not feel like a chore, short enough that
# abandoned devices eventually lose access. Tied to a future
# "log out everywhere" feature.
_SESSION_TTL_DAYS = 30


def hash_password(plaintext: str) -> str:
    """bcrypt-hash a password. Plaintext is byte-truncated to 72 bytes
    (bcrypt's hard limit) to avoid silent truncation surprises."""
    pw_bytes = plaintext.encode("utf-8")[:72]
    salt = bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    return bcrypt.hashpw(pw_bytes, salt).decode("ascii")


def verify_password(plaintext: str, password_hash: str) -> bool:
    """Constant-time compare. Returns False on any error (including
    malformed hash) so a bad row never leaks timing info."""
    try:
        pw_bytes = plaintext.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


# ---- User ops -------------------------------------------------------------
def find_user_by_email(db: DbSession, email: str) -> Optional[User]:
    return db.execute(
        select(User).where(User.email == email.lower())
    ).scalar_one_or_none()


def find_user_by_id(db: DbSession, user_id: UUID) -> Optional[User]:
    return db.execute(
        select(User).where(User.id == user_id)
    ).scalar_one_or_none()


def create_user(
    db: DbSession, email: str, password: str, display_name: Optional[str] = None
) -> User:
    """Create + persist. Caller is responsible for catching IntegrityError
    if email collides (we still pre-check via find_user_by_email in the
    router for a clean 409)."""
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        display_name=display_name or "",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---- Session ops ----------------------------------------------------------
def issue_session(db: DbSession, user: User) -> tuple[str, datetime]:
    """Create a new session row, return (raw_token, expires_at).

    raw_token is what the client sees in the cookie. The DB only
    stores sha256(raw_token) for lookup."""
    raw = generate_session_token()
    expires = datetime.now(timezone.utc) + timedelta(days=_SESSION_TTL_DAYS)
    sess = Session(
        token_hash=hash_session_token(raw),
        user_id=user.id,
        expires_at=expires.replace(tzinfo=None),  # DB stores naive UTC
    )
    db.add(sess)
    # Mark login so the user record reflects it. Cheap write.
    user.last_login_at = datetime.utcnow()
    db.commit()
    return raw, expires


def resolve_session(db: DbSession, raw_token: str) -> Optional[User]:
    """Look up the session by sha256(raw_token), check expiry, return
    the associated User (or None if not found / expired). Updates
    last_seen_at as a side effect (best-effort, not awaited)."""
    sess = db.get(Session, hash_session_token(raw_token))
    if sess is None:
        return None
    # DB stores naive UTC; compare against naive UTC.
    now = datetime.utcnow()
    if sess.expires_at < now:
        # Expired — best-effort cleanup
        db.delete(sess)
        db.commit()
        return None
    sess.last_seen_at = now
    db.commit()
    return db.get(User, sess.user_id)


def revoke_session(db: DbSession, raw_token: str) -> bool:
    """Delete the session row. Returns True if a row was removed."""
    sess = db.get(Session, hash_session_token(raw_token))
    if sess is None:
        return False
    db.delete(sess)
    db.commit()
    return True
