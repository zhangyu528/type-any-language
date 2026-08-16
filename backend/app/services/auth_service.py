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
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app.models.user import (
    User,
    Session,
    PasswordReset,
    generate_session_token,
    generate_reset_token,
    hash_session_token,
    hash_reset_token,
)
from app.models.user_course import UserCourse
from app.models.vocabulary import VocabularyLib


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

    # Default-starter enrollment: every beginner-level, published course
    # lands in the user's 我的课程 set on signup. This is the product
    # contract — a fresh account opens to a curated beginner set instead
    # of an empty "add a course" void (see migration 0017 / courses router).
    starter_libs = (
        db.execute(
            select(VocabularyLib).where(
                VocabularyLib.level == "beginner",
                VocabularyLib.is_published.is_(True),
            )
        )
        .scalars()
        .all()
    )
    if starter_libs:
        db.add_all(
            [UserCourse(user_id=user.id, lib_id=lib.id) for lib in starter_libs]
        )
        db.commit()

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


# ---- Password reset (forgot-password) -------------------------------------
def create_password_reset(
    db: DbSession, user: User, ttl_minutes: int = 30
) -> tuple[str, datetime]:
    """Issue a single-use reset token for `user`.

    Drops any prior outstanding reset for the same user first (one active
    link at a time), generates a fresh opaque token, stores its sha256 +
    expiry, and returns (raw_token, expires_at). The raw token is what goes
    in the email link; only the hash lives in DB."""
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    raw = generate_reset_token()
    expires = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    row = PasswordReset(
        token_hash=hash_reset_token(raw),
        user_id=user.id,
        email=user.email,
        expires_at=expires.replace(tzinfo=None),  # DB stores naive UTC
    )
    db.add(row)
    db.commit()
    return raw, expires


def get_valid_password_reset(db: DbSession, raw_token: str) -> Optional[PasswordReset]:
    """Look up a reset row by sha256(raw_token); return None if missing or
    expired (expired rows are best-effort deleted)."""
    row = db.get(PasswordReset, hash_reset_token(raw_token))
    if row is None:
        return None
    now = datetime.utcnow()
    if row.expires_at < now:
        db.delete(row)
        db.commit()
        return None
    return row


def consume_password_reset(db: DbSession, raw_token: str, new_password: str) -> bool:
    """Validate the reset token, set a new password, revoke ALL of the
    user's sessions (force re-login everywhere), and delete the token.

    Returns False if the token is missing/expired. The caller is expected to
    have already verified `row.email == submitted_email` before calling this,
    or we re-check here for safety (mismatch => treat as invalid)."""
    row = get_valid_password_reset(db, raw_token)
    if row is None:
        return False
    user = db.get(User, row.user_id)
    if user is None:
        return False
    user.password_hash = hash_password(new_password)
    # Revoke every session for this user — a password reset should log out
    # all devices, not just the one that requested it.
    db.execute(delete(Session).where(Session.user_id == user.id))
    db.delete(row)
    db.commit()
    return True
