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
    # Number of practice sessions started that day. Surfaces the
    # "场次" (sessions) trend metric on the data page without a
    # second endpoint — DailyActivity already stores it.
    sessions_count: int = 0
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


# ---- Progress Snapshot (3 KPI cards) ------------------------------------
class KpiStat(BaseModel):
    """One KPI tile: a value, a delta vs the prior window, and a label."""

    model_config = ConfigDict(populate_by_name=True)

    value: float
    # Signed delta vs the immediately-prior equal-length window. The
    # dashboard renders ▲/▼ and tints accordingly. 0.0 = no change.
    delta: float
    label: str


# ---- Lifetime stats (achievements / weak points) -------------------------
class LifetimeStats(BaseModel):
    """Lifetime rollup across ALL of the user's practice (not the 35-day
    calendar window). Powers the achievements page + corrects the
    AchievementWall's previously-window-limited totals.

    Derived from daily_activity (a pre-aggregated per-day rollup), so it
    is O(days) not O(attempts) — cheap even for long-tenured users.
    """

    model_config = ConfigDict(populate_by_name=True)

    total_sentences: int
    total_correct: int
    days_practiced: int
    # 0.0–1.0 lifetime accuracy; None when the user has no attempts yet
    # (so the UI can render "—" instead of a misleading 100%).
    accuracy: Optional[float] = None


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
    # Three KPI tiles keyed by name. Keys: "accuracy", "sentences",
    # "new_words". The DashboardResponse is open to more tiles later
    # (e.g. "review_queue_count") without a schema bump.
    progress: dict[str, KpiStat]
    # Server time the snapshot was generated. Lets the frontend tell
    # the user "Updated 2 min ago" if it lingers.
    generated_at: datetime
    # Most common hour-of-day (0–23) the user starts practice
    # sessions, or None if they have no sessions yet. Drives the
    # contextual "你通常 21:00 练习" nudge on the overview GreetingBar.
    # Derived from practice_sessions.started_at (already persisted),
    # so no new table/endpoint is required.
    preferred_hour: Optional[int] = None
    # Lifetime "has this user ever practiced" flag. COUNT(daily_activity) > 0
    # for the user — independent of the 35-day calendar window and of the
    # user_streaks rollup (legacy accounts created before streak tracking
    # may lack a user_streaks row, which would otherwise make streak.longest
    # read as 0 and falsely trigger the first-run welcome guide). The
    # frontend gates the onboarding/welcome view on `not has_any_activity`.
    has_any_activity: bool
    # Distinct sentences due for review today: (wrong attempts in the last
    # 14 days) UNION (cloud-favorited sentences). Surfaces a "N 句待复习"
    # badge on the overview's quick-nav without a second round-trip.
    review_due_count: int = 0
    # The user's enrolled course set ("我的课程"): lib ids the user has
    # added. Powers both the homepage "我的课程" block and the 课程
    # center's "我的课程" tab. May be EMPTY for a brand-new user (signup
    # no longer auto-enrolls beginner) — the field stays a list so the UI
    # can render an "add courses" empty state without special-casing.
    enrolled_lib_ids: List[str] = Field(default_factory=list)
    # Lifetime rollup (all-time, not the 35-day calendar window). Powers the
    # achievements page + the AchievementWall's accurate totals. None for a
    # brand-new user with no daily_activity rows yet.
    lifetime: Optional[LifetimeStats] = None


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


# ---- Daily-goal mutation ------------------------------------------------
class DailyGoalUpdate(BaseModel):
    """Request body for POST /api/dashboard/daily-goal."""

    model_config = ConfigDict(populate_by_name=True)

    target: int = Field(ge=1, le=100_000)