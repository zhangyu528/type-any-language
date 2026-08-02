"""
Dashboard response schemas — single file because all shapes share the
same ConfigDict / Style B pattern and the dashboard surface is one
logical feature.

Every model uses ConfigDict(populate_by_name=True) — the project's
current house style (see schemas/lesson.py). This lets us add
field aliases when the underlying column uses a reserved word (none
of these do, but the pattern is consistent).

Field-by-field rationale is in the DashboardResponse docstring.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.auth import UserPublic


# ---- Continue Card -------------------------------------------------------
class ContinueState(BaseModel):
    """Snapshot of the user's most recent (finished or unfinished)
    practice session, plus the in-session cursor."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: Optional[UUID] = None
    lib_id: Optional[UUID] = None
    lesson_index: Optional[int] = None
    # 1-indexed position of the sentence the user is on. 0 = fresh
    # session, hasn't typed anything yet.
    current_sentence_position: int = 0
    # Total sentences attempted in this session (so far). Drives the
    # "Word #N" label on the Continue Card without re-fetching the
    # session row.
    sentences_attempted: int = 0
    # A short preview string the dashboard renders when no full sentence
    # has been typed yet — usually the lib name + lesson index.
    # "Cambridge IELTS 5 · Lesson 3" or "Free practice" when lib is None.
    preview: str = ""
    # True if the session is unfinished — the CTA copy switches between
    # "Resume" (unfinished) and "Practice again" (finished).
    is_unfinished: bool = False


# ---- Daily Goal Ring -----------------------------------------------------
class DailyGoalState(BaseModel):
    """Today's progress toward the user's daily_goal."""

    model_config = ConfigDict(populate_by_name=True)

    target: int
    today_count: int
    today_date: date
    # 0.0–1.0. UI clamps to [0, 1] when rendering the ring.
    pct: float
    completed: bool


# ---- Streak header -------------------------------------------------------
class StreakInfo(BaseModel):
    """Streak counter for the GreetingBar header."""

    model_config = ConfigDict(populate_by_name=True)

    current: int
    longest: int
    # True if today's session_count > 0; flips the CTA copy between
    # "keep it going" (true) and "practice today to reach N+1" (false).
    today_done: bool
    # The streak chain — dates from current_streak_start to last_active_date,
    # inclusive. The dashboard can render this as a row of dots or a
    # small visual; max length is current_streak (typically <30).
    active_days: List[date] = Field(default_factory=list)


# ---- 4-week calendar -----------------------------------------------------
class CalendarDay(BaseModel):
    """One day's worth of activity for the calendar grid."""

    model_config = ConfigDict(populate_by_name=True)

    date: date
    sentences_count: int
    # 0.0–1.0. None when no sentences attempted (avoid "100%" on an
    # empty day).
    accuracy: Optional[float] = None
    goal_hit: bool
    # True if date > today (server-local). The dashboard renders these
    # as muted / non-interactive placeholders.
    is_future: bool
    # True if this date is part of the current streak chain. Drives the
    # 🔥 node marker on the cell.
    is_streak_node: bool


# ---- Monthly goal bar ----------------------------------------------------
class MonthlyGoalInfo(BaseModel):
    """Progress toward the user's monthly_goal."""

    model_config = ConfigDict(populate_by_name=True)

    target: int
    current: int
    year_month: str  # "2026-07"
    achieved: bool
    # Projection: True if current pace will hit target by month end.
    # Simple heuristic — "current / days_elapsed * days_in_month >= target".
    on_track: bool


# ---- Progress Snapshot (3 KPI cards) ------------------------------------
class KpiStat(BaseModel):
    """One KPI tile: a value, a delta vs the prior window, and a label."""

    model_config = ConfigDict(populate_by_name=True)

    value: float
    # Signed delta vs the immediately-prior equal-length window. The
    # dashboard renders ▲/▼ and tints accordingly. 0.0 = no change.
    delta: float
    label: str


# ---- Composed response ---------------------------------------------------
class DashboardResponse(BaseModel):
    """The single GET /api/dashboard payload. One round-trip per page
    load — the dashboard never stitches together multiple endpoints."""

    model_config = ConfigDict(populate_by_name=True)

    user: UserPublic
    continue_session: ContinueState = Field(alias="continue")
    daily_goal: DailyGoalState
    streak: StreakInfo
    # 35 days: today-27 .. today (4 weeks inclusive of current). The
    # calendar grid renders these as 5 rows × 7 columns.
    calendar: List[CalendarDay]
    monthly_goal: MonthlyGoalInfo
    # Three KPI tiles keyed by name. Keys: "accuracy", "sentences",
    # "new_words". The DashboardResponse is open to more tiles later
    # (e.g. "review_queue_count") without a schema bump.
    progress: dict[str, KpiStat]
    # Server time the snapshot was generated. Lets the frontend tell
    # the user "Updated 2 min ago" if it lingers.
    generated_at: datetime


# ---- Day-detail drawer (clicked from calendar) ---------------------------
class DaySessionSummary(BaseModel):
    """One row in the day-detail drawer."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: UUID
    started_at: datetime
    ended_at: Optional[datetime] = None
    sentences_attempted: int
    sentences_correct: int
    is_finished: bool


class DayDetailResponse(BaseModel):
    """Response from GET /api/dashboard/day/{date}."""

    model_config = ConfigDict(populate_by_name=True)

    date: date
    sentences_count: int
    correct_count: int
    accuracy: Optional[float] = None
    goal_hit: bool
    sessions: List[DaySessionSummary]


# ---- Monthly-goal mutation ----------------------------------------------
class MonthlyGoalUpdate(BaseModel):
    """Request body for POST /api/dashboard/monthly-goal."""

    model_config = ConfigDict(populate_by_name=True)

    target: int = Field(ge=1, le=100_000)


class MonthlyGoalResponse(BaseModel):
    """Response from POST /api/dashboard/monthly-goal."""

    model_config = ConfigDict(populate_by_name=True)

    target: int
    current: int
    year_month: str
    achieved: bool
    on_track: bool