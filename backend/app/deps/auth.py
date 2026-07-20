"""
FastAPI dependencies for auth endpoints.

Centralizes:
  - get_current_user_optional: extract User from cookie, return None
    if absent/expired (used by GET /me)
  - get_current_user: same but raises 401 if not authenticated (used
    by /logout to ensure only the cookie's owner can revoke it)

Cookie name "tal_session" is module-level so the router uses the same
constant — no string drift between writer and reader.

The cookie is read directly from the request, not via OAuth2PasswordBearer,
because OAuth2 expects a Bearer token in the Authorization header. We use
HttpOnly cookies, which is the right call for a browser-driven SPA but
needs this manual extraction.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.user import User
from app.services import auth_service

COOKIE_NAME = "tal_session"


def get_current_user_optional(
    db: DbSession = Depends(get_db),
    tal_session: Optional[str] = Cookie(default=None, alias=COOKIE_NAME),
) -> Optional[User]:
    """Return the authenticated User, or None if the cookie is missing
    or the session is expired/invalid.

    Used by GET /api/auth/me — a 401 there is a *state* (anonymous), not
    an error, so we don't raise. The frontend hydrates `user` to null
    and renders the chrome accordingly."""
    if not tal_session:
        return None
    user = auth_service.resolve_session(db, tal_session)
    return user if (user and user.is_active) else None


def get_current_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    """Require an authenticated user. Raises 401 otherwise.

    Used by POST /api/auth/logout so only the cookie's owner can revoke
    their own session (defense in depth — the cookie is HttpOnly so JS
    can't forge it, but a CSRF guard still belongs on state-changing
    endpoints)."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return user
