"""
User model — auth-owning user record.

Separate from the content models (vocabulary/sentences) so the read-layer
CMS pipeline never touches the auth table. The CMS pipeline imports CSVs +
bakes content; auth users are runtime-only and live in a separate namespace
(no bake-time concept).

Field design:
  - id: UUID primary key (matches the project's UUID convention)
  - email: lowercase, UNIQUE — login identifier; case-insensitive lookup
  - password_hash: bcrypt 12-round hash, never plaintext
  - display_name: shown in UI (header avatar, history page). Optional —
    falls back to the local-part of email when missing.
  - created_at / last_login_at: timestamps; last_login_at is the smoke
    signal for "did this user actually engage"
  - is_active: soft-delete flag (false = banned, can't login). Kept
    separate from row deletion so we can audit + recover.

No email-verification column at v1 — the backend doesn't send email yet.
Add `email_verified_at` when SMTP lands (phase 5 of the product list).
"""
import uuid
from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(100), nullable=True, default="")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    # Dashboard preferences — added in migration 0011. The monthly
    # target was retired in 0018 after the home page switched to a
    # learning-level widget driven by lifetime total_sentences; only
    # daily_goal remains as a column.
    daily_goal = Column(Integer, nullable=False, default=20)


"""
Session — server-side record of a logged-in client.

Why server-side sessions and not JWTs:
  - Revocation: if a user reports their laptop was stolen, we delete
    the session row in DB and the cookie becomes useless on next
    request. JWTs can't be revoked before expiry.
  - Audit: every request that touches a session can join back to a
    user_id + created_at for security logs.
  - Simpler secret management: no signing key rotation.

Trade-off: every authenticated request does 1 extra SELECT on
sessions + 1 on users. For an English-learning app this is well under
any threshold; if we later see hot users, add an LRU cache.

Cookie binding: the cookie value is a random opaque token
(secrets.token_urlsafe(32)). Server stores sha256(token) in this
table, never the raw token — so a DB leak doesn't immediately
compromise live sessions.
"""
import secrets
import hashlib
from sqlalchemy import Column, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID

class Session(Base):
    __tablename__ = "sessions"

    # The cookie value's sha256 hash. Raw token only lives in the
    # browser's cookie jar, never in DB.
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_sessions_expires_at", "expires_at"),
    )


def hash_session_token(raw_token: str) -> str:
    """sha256 hex of a session token. Used to look up the session row
    from the cookie value without storing the raw token in DB."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_session_token() -> str:
    """32 random bytes URL-safe base64. ~43 chars, 256 bits of entropy.
    Sufficient against brute-force even for a long-lived session."""
    return secrets.token_urlsafe(32)


"""
PasswordReset — single-use, short-lived token for the "forgot password" flow.

Why a separate table (not a column on users):
  - A user can only have one outstanding reset at a time (we delete prior
    rows on issue), so a 1-row-per-active-reset table is the natural shape.
  - The raw token lives only in the email link; DB stores sha256(token) so a
    DB leak doesn't expose live reset tokens. Identical pattern to sessions.
  - expires_at lets us reject stale links and prune with a sweep index.

No email column is sent to the client; the link carries email as a query
param and we verify it matches the row on consume (defense against a token
being replayed against a different address).
"""


def hash_reset_token(raw_token: str) -> str:
    """sha256 hex of a reset token — same rationale as hash_session_token."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_reset_token() -> str:
    """Opaque random token for the reset link. 256 bits of entropy."""
    return secrets.token_urlsafe(32)


class PasswordReset(Base):
    __tablename__ = "password_resets"

    token_hash = Column(String(64), primary_key=True)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("ix_password_resets_expires_at", "expires_at"),
    )
