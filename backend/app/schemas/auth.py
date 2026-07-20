"""
Pydantic request/response schemas for the auth endpoints.

Kept in a single file because the surface is small and the validation
rules are shared across signup/login (email format, password length).

`UserPublic` is the projection we return to the frontend — never
include password_hash, even though it's in the model. Defense in
depth: if a future router forgets to strip it, the schema layer
won't.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, field_validator


# ---- Signup ---------------------------------------------------------------
class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    # display_name is optional at signup; we fall back to email's
    # local-part. The frontend currently doesn't send it, so we
    # accept the absence gracefully.
    display_name: Optional[str] = Field(default=None, max_length=100)


# ---- Login ----------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


# ---- Public user projection ----------------------------------------------
class UserPublic(BaseModel):
    id: UUID
    email: EmailStr
    display_name: str
    created_at: datetime

    @classmethod
    def from_model(cls, user) -> "UserPublic":
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name or user.email.split("@", 1)[0],
            created_at=user.created_at,
        )


# ---- Generic error envelope ----------------------------------------------
class ErrorResponse(BaseModel):
    detail: str
    # Optional field-level errors keyed by field name. Frontend uses
    # this to light up the right input. We keep it on ErrorResponse
    # (not just raise) so it's part of the OpenAPI schema and the
    # frontend can codegen-derive the type.
    field_errors: Optional[dict[str, str]] = None
