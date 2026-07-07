"""
Auth dependencies — `get_current_user` is the FastAPI dependency every
protected route depends on. Reads the JWT from the `tal_session`
cookie, decodes it, and looks up the user in the DB.

Failure modes all collapse to 401 "Not authenticated" — we don't leak
whether the token was missing, malformed, expired, or valid-but-user-
gone. The only special case is `is_active=False` → 403 "Account
disabled" (a known authenticated-but-disabled state).
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.auth_service import COOKIE_NAME, decode_token


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current user from the `tal_session` cookie.

    Raises:
        401: missing cookie, malformed/expired JWT, or user not found.
        403: user.is_active is False.
    """
    token: Optional[str] = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # Decode — pyjwt raises on invalid signature / expiry.
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    user_id_raw = payload.get("sub")
    if not user_id_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    try:
        user_id = UUID(user_id_raw)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        # Token signed correctly but the user has been deleted since.
        # Indistinguishable from "no token" to the client.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled"
        )

    return user