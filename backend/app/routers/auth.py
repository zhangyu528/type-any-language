"""
Auth router — /api/auth/{signup,login,me,logout}.

Thin layer: parse + validate (Pydantic), call the service, format
response. No business logic here.

Response codes:
  POST /api/auth/signup    201 + Set-Cookie + UserPublic
                           409 if email already exists
                           422 if password fails length / email format
  POST /api/auth/login     200 + Set-Cookie + UserPublic
                           401 if email or password is wrong
  GET  /api/auth/me        200 + UserPublic   if cookie valid
                           401 (but we return null, see note) if not
  POST /api/auth/logout    204                on success
                           401 if no cookie

Note on /me: 401 vs null. The dependency get_current_user_optional
returns None for missing/expired cookies, so the response is always
200 with a UserPublic or {"user": null}. We choose this over 401
because the frontend's <AuthProvider> treats 401 as a hard failure
(logout everyone); null is the natural "anonymous" state. CSRF is
not a concern for GET; we just want a hydration-friendly answer.

CSRF: state-changing endpoints (signup/login/logout) require a same-
site cookie + CORS allow_credentials with an explicit origin. CORS
preflight covers browsers. For non-browser clients, document the
cookie requirement.
"""
from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession
from urllib.parse import quote

from app.config import get_settings
from app.database import get_db
from app.deps.auth import (
    COOKIE_NAME,
    get_current_user,
    get_current_user_optional,
)
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    UpdateDisplayNameRequest,
    UserPublic,
)
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, raw_token: str, max_age_seconds: int) -> None:
    """Set the tal_session cookie. HttpOnly so XSS can't grab it;
    SameSite=Lax so the auth surface isn't trivially CSRF-able from
    cross-site POSTs. Secure flag is left off in dev (localhost http);
    enable it once we serve over https.

    max_age_seconds is the browser-side TTL — we pass the same value
    as the server-side session expiry so a refresh keeps the cookie
    alive for another 30 days only on /login or /signup. The server-
    side expires_at column is the source of truth; this is just the
    browser's hint."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=max_age_seconds,
        httponly=True,
        samesite="lax",
        # secure=True,  # enable when serving over https
        path="/",
    )


def _seconds_until(expires_at) -> int:
    """Browser-side cookie max-age. expires_at is stored as naive UTC
    in the DB; convert it to seconds-since-epoch difference vs now."""
    import time
    return int(expires_at.replace(tzinfo=None).timestamp() - time.time())


@router.post("/signup", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def signup(
    payload: SignupRequest,
    response: Response,
    db: DbSession = Depends(get_db),
) -> UserPublic:
    """Create a user, issue a session, set the cookie, return the user."""
    if auth_service.find_user_by_email(db, payload.email) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱已注册",
        )
    try:
        user = auth_service.create_user(
            db,
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
        )
    except IntegrityError:
        # Race: another request created the same email between our
        # pre-check and the INSERT. Treat as conflict.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱已注册",
        )

    raw_token, expires = auth_service.issue_session(db, user)
    _set_session_cookie(response, raw_token, max_age_seconds=_seconds_until(expires))
    return UserPublic.from_model(user)


@router.post("/login", response_model=UserPublic)
def login(
    payload: LoginRequest,
    response: Response,
    db: DbSession = Depends(get_db),
) -> UserPublic:
    """Verify password, issue a session, set the cookie, return the user.

    Returns 401 for both "unknown email" and "wrong password" with the
    same message — never reveal which one is correct. This is a
    well-known defense against email-enumeration attacks.
    """
    user = auth_service.find_user_by_email(db, payload.email)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )
    if not auth_service.verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )

    raw_token, expires = auth_service.issue_session(db, user)
    _set_session_cookie(response, raw_token, max_age_seconds=_seconds_until(expires))
    return UserPublic.from_model(user)


@router.get("/me")
def me(
    user: User | None = Depends(get_current_user_optional),
) -> dict:
    """Return the current user, or {"user": null} if anonymous.

    See module docstring for why this is 200-with-null rather than 401."""
    if user is None:
        return {"user": None}
    return {"user": UserPublic.from_model(user).model_dump(mode="json")}


@router.patch("/me", response_model=UserPublic)
def update_me(
    payload: UpdateDisplayNameRequest,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> UserPublic:
    """Update the current user's display_name.

    Auth-required — anonymous callers get 401 from get_current_user.
    Empty / over-length input is rejected at the Pydantic layer (422).
    Returns the post-update UserPublic so the client can refresh its
    cached projection in one round-trip.
    """
    current_user.display_name = payload.display_name.strip()
    db.commit()
    db.refresh(current_user)
    return UserPublic.from_model(current_user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    response: Response,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tal_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> Response:
    """Permanently delete the account and all associated cloud data.

    Every user-owned table (sessions, password_resets, user_favorites,
    practice_attempts, practice_sessions, user_progress, daily_activity,
    user_streak) declares ON DELETE CASCADE on its users.id FK, so a
    single DELETE FROM users wipes the whole graph. We revoke the
    current session explicitly first, then drop the cookie.
    """
    if tal_session:
        auth_service.revoke_session(db, tal_session)
    db.delete(current_user)
    db.commit()
    response.delete_cookie(key=COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),  # noqa: ARG001 — side-effect for auth gate
    tal_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> Response:
    """Revoke the session. Always clear the cookie, even if the row
    is already gone (e.g. expired). Returns 204."""
    if tal_session:
        auth_service.revoke_session(db, tal_session)
    # Tell the browser to drop the cookie. max_age=0 with same path
    # overrides any earlier Set-Cookie.
    response.delete_cookie(key=COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


# ---------------------------------------------------------------------------
# Forgot / reset password
# ---------------------------------------------------------------------------
@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    db: DbSession = Depends(get_db),
) -> dict:
    """Request a password reset link.

    Security: always returns the same 200 envelope regardless of whether the
    email exists, so the endpoint can't be used to enumerate registered
    accounts. We only generate + (log / return) a link when the user exists
    and is active.

    Delivery: there is no email provider wired up yet (phase 5). In dev we
    (a) print the link to the server log and (b) — when settings.is_dev() —
    return it in the response so a local loop works without SMTP. In prod,
    replace the TODO with an SMTP send and stop returning dev_reset_url.
    """
    user = auth_service.find_user_by_email(db, payload.email)
    dev_reset_url: str | None = None
    if user is not None and user.is_active:
        raw_token, _ = auth_service.create_password_reset(db, user)
        settings = get_settings()
        reset_url = (
            f"{settings.APP_BASE_URL.rstrip('/')}/reset-password"
            f"?token={raw_token}&email={quote(user.email)}"
        )
        # TODO(phase 5): send_email(user.email, "重置密码", reset_url)
        print(f"[auth] password reset link for {user.email}: {reset_url}")
        dev_reset_url = reset_url if settings.is_dev() else None
    return {
        "ok": True,
        "message": "如果该邮箱已注册，我们已发送重置邮件",
        "dev_reset_url": dev_reset_url,
    }


@router.get("/reset-password/validate")
def validate_reset_password(
    token: str,
    email: str,
    db: DbSession = Depends(get_db),
) -> dict:
    """Pre-check a reset link (used by the /reset-password page to show a
    friendly "expired" state before the user types a new password)."""
    row = auth_service.get_valid_password_reset(db, token)
    valid = row is not None and row.email == email.lower()
    return {"valid": valid}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(
    payload: ResetPasswordRequest,
    db: DbSession = Depends(get_db),
) -> dict:
    """Consume a reset token and set a new password.

    On success we also revoke all of the user's sessions (see
    auth_service.consume_password_reset). Invalid/expired tokens return 400
    with a generic message — never reveal whether the token or the email
    was the problem.
    """
    ok = auth_service.consume_password_reset(db, payload.token, payload.password)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="重置链接无效或已过期，请重新申请",
        )
    return {"ok": True, "message": "密码已重置"}
