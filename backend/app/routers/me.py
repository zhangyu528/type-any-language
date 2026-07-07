"""
User-scoped routes — currently just `/api/history` as an auth-gated
placeholder. Real history data lives in a future PR; the deliverable
for v1 is the gate itself (proving the cookie → dependency →
DB-lookup → response path works end-to-end).
"""
from fastapi import APIRouter, Depends

from app.deps.auth import get_current_user
from app.models.user import User
from app.schemas.auth import HistoryResponse
from app.schemas.user import UserPublic


router = APIRouter(tags=["me"])


@router.get("/api/history", response_model=HistoryResponse)
def get_history(current_user: User = Depends(get_current_user)):
    """Protected placeholder. Returns the current user + an empty list
    so the frontend can render an account-summary view."""
    return HistoryResponse(
        items=[],
        user=UserPublic.model_validate(current_user),
    )