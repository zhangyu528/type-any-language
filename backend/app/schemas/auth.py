"""
Auth request / response schemas — wire shape for /api/auth/*.

Validation rules:
  - email     : RFC 5322-ish via EmailStr (email-validator package)
  - password  : min 8 chars (basic entropy), max 72 (bcrypt input cap).
                Frontend mirrors this; reject oversize at the boundary.
  - display_name: 1-50 chars; trimmed at the schema layer.
"""
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserPublic


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72)
    display_name: str = Field(..., min_length=1, max_length=50)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=72)


class AuthResponse(BaseModel):
    """Returned by signup / login. Token is also set as an httpOnly
    cookie — `token` here is for clients that prefer header-based auth
    (e.g. mobile) and is the canonical source for the cookie payload."""
    user: UserPublic
    token: str
    expires_in: int  # seconds until the JWT expires (mirrors max_age)


class MessageResponse(BaseModel):
    """Generic message envelope for endpoints that don't return a
    resource (e.g. logout)."""
    detail: str


class HistoryResponse(BaseModel):
    """Placeholder response for /api/history. Real data is out of
    scope for v1 — we just need the auth gate to exist."""
    items: list = []
    user: UserPublic