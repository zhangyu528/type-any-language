"""
Auth router — signup / login / logout / me.

All four endpoints deal with the httpOnly session cookie. The cookie is
the source of truth at the HTTP boundary; the `token` field in the
JSON body is a convenience for clients that want to read the token
(e.g. mobile apps), but the browser SPA never needs it.

Error mapping (kept consistent so the frontend can do string matching):
  - 401: invalid email/password (login), missing/expired session (me)
  - 403: account disabled
  - 409: email already registered (signup)
  - 422: Pydantic validation failure (bad email format, short password)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.user import User
from app.schemas.auth import AuthResponse, LoginRequest, MessageResponse, SignupRequest
from app.schemas.user import UserPublic
from app.services.auth_service import (
    COOKIE_NAME,
    cookie_max_age,
    create_access_token,
    hash_password,
    verify_password,
)
from app.config import get_settings


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    """Set the tal_session httpOnly cookie on the response."""
    settings = get_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
        max_age=cookie_max_age(),
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_200_OK)
def signup(payload: SignupRequest, response: Response, db: Session = Depends(get_db)):
    """Create a new user and start a session.

    Duplicate emails surface as 409 (from the DB UNIQUE constraint on
    users.email). We catch IntegrityError to map it explicitly — the
    alternative (pre-check) has a TOCTOU race that two concurrent
    signups could both pass.
    """
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )
    db.refresh(user)

    token, expires_in = create_access_token(user.id)
    _set_session_cookie(response, token)
    return AuthResponse(
        user=UserPublic.model_validate(user),
        token=token,
        expires_in=expires_in,
    )


@router.post("/login", response_model=AuthResponse, status_code=status.HTTP_200_OK)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Verify credentials and start a session.

    Lookup is case-insensitive on email (matches `ix_users_email_lower`).
    The 401 message is identical for "no such user" and "wrong password"
    to prevent user enumeration.
    """
    user = (
        db.query(User)
        .filter(User.email.ilike(payload.email))
        .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled"
        )

    token, expires_in = create_access_token(user.id)
    _set_session_cookie(response, token)
    return AuthResponse(
        user=UserPublic.model_validate(user),
        token=token,
        expires_in=expires_in,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    """Clear the session cookie. Idempotent — works whether the user
    was authenticated or not (always returns 204).

    Note: returning `None` from a 204-status route works in FastAPI
    (Starlette produces an empty-body 204 response), but the cookie
    Set-Cookie header set on the `response` param is preserved through
    FastAPI's header-merge on the way out. We return a bare
    StarletteResponse here carrying the merged headers to make the
    Set-Cookie visible to all clients (TestClient, browsers, curl).
    """
    _clear_session_cookie(response)
    from starlette.responses import Response as StarletteResponse

    return StarletteResponse(
        status_code=status.HTTP_204_NO_CONTENT,
        headers=dict(response.headers),
    )


@router.get("/me", response_model=UserPublic)
def me(current_user: User = Depends(get_current_user)):
    """Return the current user. Protected — 401 without a valid cookie."""
    return UserPublic.model_validate(current_user)