"""
Dashboard router — /api/dashboard/*.

Single-page payload (GET /) plus a few sub-resources for the day
drawer and monthly-goal mutation. Every endpoint requires auth via
Depends(get_current_user).

GET /api/dashboard is the dashboard's one round-trip; the frontend
never stitches it together. The other endpoints exist for the day
drawer (rarely opened, doesn't need to be in the main payload) and
the settings-page mutation.
"""
from __future__ import annotations

from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.user import User
from app.schemas.auth import UserPublic
from app.schemas.dashboard import (
    DailyGoalState,
    DailyGoalUpdate,
    DashboardResponse,
    DayDetailResponse,
    MonthlyGoalInfo,
    MonthlyGoalResponse,
    MonthlyGoalUpdate,
)
from app.services import activity_service

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> DashboardResponse:
    """Compose the dashboard's one-shot payload.

    today is the server's local date — the dashboard service does
    not yet honour per-user timezones (planned for a later phase).
    """
    from datetime import datetime

    today = date_cls.today()

    return DashboardResponse(
        user=UserPublic.from_model(current_user),
        continue_session=activity_service.compute_continue_state(db, current_user.id),
        daily_goal=activity_service.compute_daily_goal(db, current_user.id, today),
        streak=activity_service.compute_streak(db, current_user.id, today),
        calendar=activity_service.compute_calendar(db, current_user.id, today),
        monthly_goal=activity_service.compute_monthly_goal(db, current_user.id, today),
        progress=activity_service.compute_kpis(db, current_user.id, today),
        preferred_hour=activity_service.compute_preferred_hour(db, current_user.id),
        has_any_activity=activity_service.has_any_activity(db, current_user.id),
        generated_at=datetime.utcnow(),
    )


@router.get("/calendar", response_model=list)
def get_calendar(
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list:
    """Return only the 4-week calendar — used for incremental
    hydration when the dashboard wants to refresh the grid without
    re-fetching the full payload (e.g. after a session end)."""
    today = date_cls.today()
    return activity_service.compute_calendar(db, current_user.id, today)


@router.get("/streak", response_model=None)  # type: ignore[arg-type]
def get_streak(
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """Return only the streak info — used by the GreetingBar when the
    user comes back to /dashboard in a new tab."""
    today = date_cls.today()
    return activity_service.compute_streak(db, current_user.id, today)


@router.get("/day/{day_date}", response_model=DayDetailResponse)
def get_day_detail(
    day_date: date_cls,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> DayDetailResponse:
    """Day-detail payload for the calendar cell drawer.

    Future dates return an empty payload (200 with zero counts)."""
    if day_date > date_cls.today():
        return DayDetailResponse(
            date=day_date,
            sentences_count=0,
            correct_count=0,
            accuracy=None,
            goal_hit=False,
            sessions=[],
        )
    return activity_service.compute_day_detail(db, current_user.id, day_date)


@router.post("/monthly-goal", response_model=MonthlyGoalResponse)
def update_monthly_goal(
    payload: MonthlyGoalUpdate,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> MonthlyGoalResponse:
    """Set users.monthly_goal. Returns the post-update MonthlyGoalInfo."""
    current_user.monthly_goal = payload.target
    db.commit()
    db.refresh(current_user)

    today = date_cls.today()
    info = activity_service.compute_monthly_goal(db, current_user.id, today)
    return MonthlyGoalResponse(
        target=info.target,
        current=info.current,
        year_month=info.year_month,
        achieved=info.achieved,
        on_track=info.on_track,
    )


@router.post("/daily-goal", response_model=DailyGoalState)
def update_daily_goal(
    payload: DailyGoalUpdate,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> DailyGoalState:
    """Set users.daily_goal. Returns the post-update DailyGoalState.

    The frontend's DailyGoal ring / OverviewSection goal editor calls
    this so the user can tune their per-day sentence target without
    leaving the console. Reuses activity_service.compute_daily_goal so
    pct / completed reflect the new target immediately.
    """
    current_user.daily_goal = payload.target
    db.commit()
    db.refresh(current_user)

    today = date_cls.today()
    return activity_service.compute_daily_goal(db, current_user.id, today)