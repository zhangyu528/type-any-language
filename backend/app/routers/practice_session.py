"""
Practice-session router — /api/practice/session/*.

The endpoints the frontend calls during a /practice round:
  POST /api/practice/session/start   begin a new session, optional
                                     lib/lesson context
  POST /api/practice/session/{id}/step   report one sentence outcome
                                     (per-question telemetry)
  POST /api/practice/session/{id}/end  close the session; triggers the
                                     daily_activity rollup + streak
                                     update as side effects

Why a separate router from dashboard: the practice session is a write
surface the dashboard reads. Keeping the write surface small and
self-contained makes the dashboard's "where did I leave off" read
predictable — we know exactly what writes can happen and where.

Step endpoint notes:
  - We do NOT persist per-step rows in v1 (no practice_steps table).
    The /step endpoint just bumps the session's sentences_attempted /
    sentences_correct counters. A future "drill into session" drawer
    can fan out from here.
  - The step endpoint returns 204; the client treats it as fire-and-
    forget. Network failures are best-effort — the /end endpoint
    always wins because it carries the final totals.

End endpoint notes:
  - Mark the session is_finished, set ended_at, then call the two
    rollup helpers. The rollups are SQL-side (INSERT … ON CONFLICT)
    so a retry of /end is safe — it would just re-add the same
    counters. To make /end truly idempotent, we check is_finished
    first and short-circuit on second call.
"""
from __future__ import annotations

from datetime import date as date_cls, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.practice_session import PracticeSession
from app.models.user import User
from app.models.user_progress import UserProgress
from app.services import activity_service

router = APIRouter(prefix="/api/practice/session", tags=["practice"])


# ---- Request / response shapes -------------------------------------------

class StartRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    lib_id: Optional[UUID] = None
    lesson_index: Optional[int] = Field(default=None, ge=1)


class StartResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    session_id: UUID


class StepRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    correct: bool


class EndRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    # Final totals the frontend has accumulated. The server trusts the
    # caller's counts (the step endpoint is best-effort and can drop on
    # network failure); these values are what gets written.
    sentences_attempted: int = Field(ge=0)
    sentences_correct: int = Field(ge=0)


class EndResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    session_id: UUID
    is_finished: bool
    # Echo back the daily goal + streak state so the dashboard can
    # optimistically reflect without a second round-trip.
    today_count: int
    today_target: int
    today_completed: bool
    current_streak: int


# ---- Endpoints -----------------------------------------------------------

@router.post("/start", response_model=StartResponse, status_code=201)
def start_session(
    payload: StartRequest,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> StartResponse:
    """Begin a new practice session. Also upserts user_progress so
    the Continue Card can resume this session on a refresh."""
    sess = PracticeSession(
        user_id=current_user.id,
        lib_id=payload.lib_id,
        lesson_index=payload.lesson_index,
        started_at=datetime.utcnow(),
        is_finished=False,
    )
    db.add(sess)
    db.flush()  # populate sess.id without committing

    # Upsert user_progress — uses a SELECT-then-INSERT/UPDATE so we
    # can express "fresh row OR overwrite existing" cleanly. The
    # previous unfinished session (if any) is left in place; the
    # dashboard's compute_continue_state picks the most-recent
    # unfinished, which is now this one.
    progress = (
        db.query(UserProgress)
        .filter(UserProgress.user_id == current_user.id)
        .first()
    )
    if progress is None:
        db.add(UserProgress(
            user_id=current_user.id,
            last_session_id=sess.id,
            last_lib_id=payload.lib_id,
            last_lesson_index=payload.lesson_index,
            current_sentence_position=0,
            updated_at=datetime.utcnow(),
        ))
    else:
        progress.last_session_id = sess.id
        progress.last_lib_id = payload.lib_id
        progress.last_lesson_index = payload.lesson_index
        progress.current_sentence_position = 0
        progress.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(sess)
    return StartResponse(session_id=sess.id)


@router.post("/{session_id}/step")
def record_step(
    session_id: UUID,
    payload: StepRequest,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> Response:
    """Record a single sentence outcome. Bumps the session's counters
    and advances user_progress.current_sentence_position by 1.

    Fire-and-forget from the frontend's perspective — no body is
    returned. We return 204 on success and 404 if the session doesn't
    belong to the caller, so the frontend can debug misrouted calls.

    `Response(status_code=204)` (rather than `status_code=204` on the
    route decorator) sidesteps FastAPI's "204 must not have a body"
    assert that fires when the return type is annotated as `None`.
    """
    sess = (
        db.query(PracticeSession)
        .filter(PracticeSession.id == session_id)
        .filter(PracticeSession.user_id == current_user.id)
        .first()
    )
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    if sess.is_finished:
        # Late step arrived after /end. Drop silently — the /end totals
        # are authoritative. 204 keeps the frontend's fire-and-forget
        # path consistent.
        return Response(status_code=204)

    sess.sentences_attempted = int(sess.sentences_attempted) + 1
    if payload.correct:
        sess.sentences_correct = int(sess.sentences_correct) + 1

    progress = (
        db.query(UserProgress)
        .filter(UserProgress.user_id == current_user.id)
        .first()
    )
    if progress is not None:
        progress.current_sentence_position = int(progress.current_sentence_position) + 1
        progress.updated_at = datetime.utcnow()

    db.commit()
    return Response(status_code=204)


@router.post("/{session_id}/end", response_model=EndResponse)
def end_session(
    session_id: UUID,
    payload: EndRequest,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> EndResponse:
    """Close the session. Authoritative: replaces the session's
    attempted/correct counters with the caller-supplied totals (so
    a lost /step batch doesn't undercount), then runs the rollup.

    Idempotent: a second call after the session is already finished
    returns the same response without re-running the rollup.
    """
    sess = (
        db.query(PracticeSession)
        .filter(PracticeSession.id == session_id)
        .filter(PracticeSession.user_id == current_user.id)
        .first()
    )
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")

    today = date_cls.today()

    if sess.is_finished:
        # Replayed /end. Read current state without re-rolling up.
        goal = activity_service.compute_daily_goal(db, current_user.id, today)
        streak = activity_service.compute_streak(db, current_user.id, today)
        return EndResponse(
            session_id=sess.id,
            is_finished=True,
            today_count=goal.today_count,
            today_target=goal.target,
            today_completed=goal.completed,
            current_streak=streak.current,
        )

    # Authoritative totals from the caller.
    sess.sentences_attempted = int(payload.sentences_attempted)
    sess.sentences_correct = int(payload.sentences_correct)
    sess.is_finished = True
    sess.ended_at = datetime.utcnow()

    # Roll up. These two helpers are no-ops if the user already has
    # activity on `today` (the SQL is upsert-arithmetic), so a partial
    # failure between them is safe to retry.
    activity_service.rollup_session_to_daily(db, current_user.id, sess, today)
    activity_service.update_streak_on_activity(db, current_user.id, today)

    db.commit()

    goal = activity_service.compute_daily_goal(db, current_user.id, today)
    streak = activity_service.compute_streak(db, current_user.id, today)
    return EndResponse(
        session_id=sess.id,
        is_finished=True,
        today_count=goal.today_count,
        today_target=goal.target,
        today_completed=goal.completed,
        current_streak=streak.current,
    )