"""
Courses router — /api/courses/{lib_id}/enroll.

The enrollment surface for the dashboard's "我的课程" model. A user
browses the published catalog (发现, served by /api/content/catalog)
and *adds* courses here; the dashboard snapshot's `enrolled_lib_ids`
is the read side that powers both the homepage "我的课程" block and the
课程 center's "我的课程" tab.

Both endpoints require auth (get_current_user). Enroll is idempotent
(duplicate adds are a no-op, 204); unenroll is a quiet delete (204 even
if nothing was enrolled). Invalid / unpublished lib ids return 404 so
the client can drop a stale card.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.user import User
from app.models.user_course import UserCourse
from app.models.vocabulary import VocabularyLib

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _parse_lib_id(lib_id: str) -> UUID:
    try:
        return UUID(lib_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="课程不存在",
        )


@router.post("/{lib_id}/enroll", status_code=status.HTTP_204_NO_CONTENT)
def enroll_course(
    lib_id: str,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Add a course to the user's 我的课程. Idempotent."""
    lib_uuid = _parse_lib_id(lib_id)
    lib = db.get(VocabularyLib, lib_uuid)
    if lib is None or not lib.is_published:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="课程不存在或未发布",
        )

    exists = db.execute(
        select(UserCourse).where(
            UserCourse.user_id == current_user.id,
            UserCourse.lib_id == lib_uuid,
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(UserCourse(user_id=current_user.id, lib_id=lib_uuid))
        db.commit()


@router.delete("/{lib_id}/enroll", status_code=status.HTTP_204_NO_CONTENT)
def unenroll_course(
    lib_id: str,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> None:
    """Remove a course from the user's 我的课程. Quiet no-op if absent."""
    lib_uuid = _parse_lib_id(lib_id)
    db.execute(
        select(UserCourse)
        .where(UserCourse.user_id == current_user.id)
        .where(UserCourse.lib_id == lib_uuid)
    ).delete(synchronize_session=False)
    db.commit()
