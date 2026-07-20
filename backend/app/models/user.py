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
from sqlalchemy import Column, String, DateTime, Boolean
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
