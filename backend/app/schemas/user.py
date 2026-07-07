"""
User response schemas — wire shape only.

These never include `password_hash` (use `UserPublic` everywhere the user
object leaves the backend, even internally — defense-in-depth).
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserPublic(BaseModel):
    """The shape of a user we return to clients (and to ourselves)."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: Optional[str] = None
    tier: Optional[str] = None
    is_active: bool = True
    created_at: datetime


# Backwards-compat alias (older code may import UserResponse)
UserResponse = UserPublic