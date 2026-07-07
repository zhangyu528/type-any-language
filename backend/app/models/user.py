"""
User model — v1 auth (email + password).

The runtime is no longer a pure read-layer for the `users` table: signup
INSERTs, login UPDATEs `last_login_at`. All other content tables
(vocabulary_libs / vocabulary_words / sentences) remain read-only.

Field design notes:
  - `password_hash` is VARCHAR(255) for forward-compat with future algorithm
    migration (current passlib bcrypt output is ~60 chars).
  - `role` / `tier` are NULL by default; reserved for future admin /
    premium gating. v1 always treats them as their natural defaults
    (`'user'` / `'free'`) via the auth_service layer.
  - `is_active` is set in v1 but never consumed as a gate — reserved for
    the future soft-delete / ban flow without needing a migration.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(50), nullable=False)
    role = Column(String(20), nullable=True)       # 'admin' | 'user' | NULL
    tier = Column(String(20), nullable=True)       # 'premium' | 'standard' | NULL
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    # last_login_at lives in the DB but isn't a Column on the SQLAlchemy
    # model in v1 — we touch it via raw SQL in auth_service to avoid the
    # schema-migration coupling (see comments there).

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r}>"