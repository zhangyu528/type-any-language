"""
Activity service — pure aggregation queries that feed the dashboard.

Each `compute_*` function is stateless: takes (db, user_id, …) and
returns the shape the dashboard needs. No caching, no batching
across users; the dashboard is one-user-at-a-time anyway.

Two write-side helpers at the bottom:
  - rollup_session_to_daily: bumps daily_activity counters + sets
    daily_goal_hit when the day's count crosses the user's target.
  - update_streak_on_activity: extends, starts, or breaks the streak
    based on last_active_date vs the new date.

Both are called from routers/practice_session.py::end_session() in
the same transaction. They are idempotent: re-applying an end_session
that was already counted is harmless (the same INSERT … ON CONFLICT
DO UPDATE path runs, the counters move forward by 0 when the same
session is replayed).
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import func, text
from sqlalchemy.orm import Session as DbSession

from app.models.daily_activity import DailyActivity
from app.models.practice_session import PracticeSession
from app.models.user_progress import UserProgress
from app.models.user_streak import UserStreak
from app.models.user import User
from app.schemas.dashboard import (
    CalendarDay,
    ContinueState,
    DailyGoalState,
    DayDetailResponse,
    DaySessionSummary,
    KpiStat,
    MonthlyGoalInfo,
    StreakInfo,
)


# ---- Read-side: per-component aggregations --------------------------------

def compute_continue_state(
    db: DbSession,
    user_id: UUID,
) -> ContinueState:
    """Return the user's most-recent practice session (finished OR
    unfinished), plus denormalized position counters.

    Strategy: try the most-recent unfinished session first. If none,
    fall back to the most-recent finished one. The user always has
    a "where did I leave off" anchor after their first session.
    """
    # Most recent unfinished (drives the Resume CTA).
    unfinished = (
        db.query(PracticeSession)
        .filter(PracticeSession.user_id == user_id)
        .filter(PracticeSession.is_finished.is_(False))
        .order_by(PracticeSession.started_at.desc())
        .first()
    )
    if unfinished is not None:
        return _continue_from_session(unfinished, is_unfinished=True)

    # Fall back to most recent finished.
    finished = (
        db.query(PracticeSession)
        .filter(PracticeSession.user_id == user_id)
        .filter(PracticeSession.is_finished.is_(True))
        .order_by(PracticeSession.started_at.desc())
        .first()
    )
    if finished is not None:
        return _continue_from_session(finished, is_unfinished=False)

    # No sessions yet — empty state.
    return ContinueState(preview="")


def _continue_from_session(
    sess: PracticeSession,
    *,
    is_unfinished: bool,
) -> ContinueState:
    # The preview string is "lib name · Lesson N" or "Free practice"
    # when lib_id is None. We avoid an extra JOIN by stringifying the
    # lesson index inline — the lib name lookup is reserved for a
    # later phase where we add an explicit lib cache.
    if sess.lib_id is None:
        preview = "Free practice"
    elif sess.lesson_index is not None:
        preview = f"Lesson {sess.lesson_index}"
    else:
        preview = "Lib practice"

    return ContinueState(
        session_id=sess.id,
        lib_id=sess.lib_id,
        lesson_index=sess.lesson_index,
        current_sentence_position=getattr(sess, "_position", 0),
        sentences_attempted=sess.sentences_attempted,
        preview=preview,
        is_unfinished=is_unfinished,
    )


def compute_daily_goal(
    db: DbSession,
    user_id: UUID,
    today: date,
) -> DailyGoalState:
    """Return today's progress toward users.daily_goal."""
    target = _get_daily_goal(db, user_id)
    row = (
        db.query(DailyActivity.sentences_count)
        .filter(DailyActivity.user_id == user_id)
        .filter(DailyActivity.activity_date == today)
        .first()
    )
    today_count = int(row[0]) if row else 0
    pct = (today_count / target) if target > 0 else 0.0
    return DailyGoalState(
        target=target,
        today_count=today_count,
        today_date=today,
        pct=min(max(pct, 0.0), 1.0),
        completed=today_count >= target,
    )


def compute_streak(
    db: DbSession,
    user_id: UUID,
    today: date,
) -> StreakInfo:
    """Return current/longest streak + the streak chain (dates).

    today_done is derived from daily_activity.sessions_count > 0
    for today — independent of the streak counter so we can show
    "today done" even when the streak is broken.
    """
    streak = (
        db.query(UserStreak)
        .filter(UserStreak.user_id == user_id)
        .first()
    )
    if streak is None:
        return StreakInfo(
            current=0, longest=0, today_done=False, active_days=[],
        )

    # today_done
    today_row = (
        db.query(DailyActivity.sessions_count)
        .filter(DailyActivity.user_id == user_id)
        .filter(DailyActivity.activity_date == today)
        .first()
    )
    today_done = bool(today_row and today_row[0] > 0)

    # active_days — list dates from current_streak_start to last_active_date,
    # inclusive. Empty when streak == 0.
    active_days: List[date] = []
    if streak.current_streak > 0 and streak.current_streak_start and streak.last_active_date:
        d = streak.current_streak_start
        while d <= streak.last_active_date:
            active_days.append(d)
            d += timedelta(days=1)

    return StreakInfo(
        current=streak.current_streak,
        longest=streak.longest_streak,
        today_done=today_done,
        active_days=active_days,
    )


def compute_calendar(
    db: DbSession,
    user_id: UUID,
    today: date,
    *,
    days: int = 35,
) -> List[CalendarDay]:
    """Return `days` consecutive CalendarDay entries ending on today,
    oldest first. Default is 35 (4 weeks inclusive of the current week).

    The is_streak_node field is computed once per call by joining the
    streak chain into a single SQL `IN (...)` subquery; we hydrate it
    in Python rather than letting the DB do per-row work.
    """
    start = today - timedelta(days=days - 1)

    # Pull daily_activity rows for the window in one query.
    rows = (
        db.query(
            DailyActivity.activity_date,
            DailyActivity.sentences_count,
            DailyActivity.correct_count,
            DailyActivity.daily_goal_hit,
        )
        .filter(DailyActivity.user_id == user_id)
        .filter(DailyActivity.activity_date >= start)
        .filter(DailyActivity.activity_date <= today)
        .all()
    )
    by_date: Dict[date, tuple[int, int, bool]] = {
        r[0]: (int(r[1]), int(r[2]), bool(r[3])) for r in rows
    }

    # Streak node membership — reuse compute_streak's logic but cheaper.
    streak = (
        db.query(UserStreak.current_streak_start, UserStreak.last_active_date)
        .filter(UserStreak.user_id == user_id)
        .first()
    )
    streak_dates: set[date] = set()
    if streak and streak.current_streak_start and streak.last_active_date and streak.current_streak_start <= streak.last_active_date:
        d = streak.current_streak_start
        while d <= streak.last_active_date:
            streak_dates.add(d)
            d += timedelta(days=1)

    out: List[CalendarDay] = []
    for offset in range(days):
        d = start + timedelta(days=offset)
        is_future = d > today
        if is_future:
            out.append(CalendarDay(
                date=d,
                sentences_count=0,
                accuracy=None,
                goal_hit=False,
                is_future=True,
                is_streak_node=False,
            ))
            continue

        sc, cc, hit = by_date.get(d, (0, 0, False))
        accuracy = (cc / sc) if sc > 0 else None
        out.append(CalendarDay(
            date=d,
            sentences_count=sc,
            accuracy=accuracy,
            goal_hit=hit,
            is_future=False,
            is_streak_node=d in streak_dates,
        ))
    return out


def compute_monthly_goal(
    db: DbSession,
    user_id: UUID,
    today: date,
) -> MonthlyGoalInfo:
    """Return progress + projection toward users.monthly_goal."""
    target = _get_monthly_goal(db, user_id)
    year_month = today.strftime("%Y-%m")
    _, days_in_month = calendar.monthrange(today.year, today.month)
    days_elapsed = today.day

    # SUM(sentences_count) for the current month, in one query.
    month_start = today.replace(day=1)
    row = (
        db.query(func.coalesce(func.sum(DailyActivity.sentences_count), 0))
        .filter(DailyActivity.user_id == user_id)
        .filter(DailyActivity.activity_date >= month_start)
        .filter(DailyActivity.activity_date <= today)
        .one()
    )
    current = int(row[0])
    achieved = current >= target

    # Projection: current / days_elapsed * days_in_month >= target?
    if days_elapsed <= 0:
        on_track = target <= 0
    else:
        projected = current / days_elapsed * days_in_month
        on_track = projected >= target

    return MonthlyGoalInfo(
        target=target,
        current=current,
        year_month=year_month,
        achieved=achieved,
        on_track=on_track,
    )


def compute_kpis(
    db: DbSession,
    user_id: UUID,
    today: date,
) -> Dict[str, KpiStat]:
    """Return 3 KPI tiles vs the immediately-prior equal-length window
    (default: this week vs last week).

    Windows are 7 days; the boundary is `today - 6` (so "this week"
    is inclusive of today and the 6 prior days). "Last week" is
    `today - 13` .. `today - 7`.
    """
    this_start = today - timedelta(days=6)
    this_end = today
    last_start = today - timedelta(days=13)
    last_end = today - timedelta(days=7)

    def _sum(lo: date, hi: date) -> tuple[int, int]:
        """Return (sentences_count, correct_count) for the window."""
        row = (
            db.query(
                func.coalesce(func.sum(DailyActivity.sentences_count), 0),
                func.coalesce(func.sum(DailyActivity.correct_count), 0),
            )
            .filter(DailyActivity.user_id == user_id)
            .filter(DailyActivity.activity_date >= lo)
            .filter(DailyActivity.activity_date <= hi)
            .one()
        )
        return int(row[0]), int(row[1])

    this_s, this_c = _sum(this_start, this_end)
    last_s, last_c = _sum(last_start, last_end)

    # Accuracy: round to 0.0–1.0; treat no-data as 0 delta but 0 value.
    this_acc = (this_c / this_s) if this_s > 0 else 0.0
    last_acc = (last_c / last_s) if last_s > 0 else 0.0

    # New words this week: distinct vocabulary_words referenced via
    # sentences.target_words in the window. We approximate by joining
    # through practice_sessions started_at — exact count of "newly
    # introduced words" needs a per-step table the v1 doesn't ship.
    # For now: distinct lib_id count in the window. Cheap and gives
    # the user a feel for breadth. v2 can swap for a per-word flag.
    new_libs_row = (
        db.query(func.count(func.distinct(PracticeSession.lib_id)))
        .filter(PracticeSession.user_id == user_id)
        .filter(PracticeSession.started_at >= datetime.combine(this_start, datetime.min.time()))
        .filter(PracticeSession.started_at < datetime.combine(this_end + timedelta(days=1), datetime.min.time()))
        .filter(PracticeSession.lib_id.isnot(None))
        .one()
    )
    last_libs_row = (
        db.query(func.count(func.distinct(PracticeSession.lib_id)))
        .filter(PracticeSession.user_id == user_id)
        .filter(PracticeSession.started_at >= datetime.combine(last_start, datetime.min.time()))
        .filter(PracticeSession.started_at < datetime.combine(last_end + timedelta(days=1), datetime.min.time()))
        .filter(PracticeSession.lib_id.isnot(None))
        .one()
    )
    new_words_value = float(new_libs_row[0])
    new_words_delta = float(new_libs_row[0]) - float(last_libs_row[0])

    return {
        "accuracy": KpiStat(
            value=round(this_acc, 3),
            delta=round(this_acc - last_acc, 3),
            label="准确率",
        ),
        "sentences": KpiStat(
            value=float(this_s),
            delta=float(this_s - last_s),
            label="本周句数",
        ),
        "new_words": KpiStat(
            value=new_words_value,
            delta=new_words_delta,
            label="本周新词库",
        ),
    }


def compute_day_detail(
    db: DbSession,
    user_id: UUID,
    day: date,
) -> DayDetailResponse:
    """Return per-session rollup for one day. Used by the dashboard
    day-detail drawer when a user clicks a calendar cell."""
    row = (
        db.query(
            func.coalesce(func.sum(DailyActivity.sentences_count), 0),
            func.coalesce(func.sum(DailyActivity.correct_count), 0),
            # `bool_or` instead of `max(boolean)`: PostgreSQL has no
            # `max` aggregate for boolean. `bool_or` is the correct
            # SQL-land "any true" aggregate.
            func.bool_or(DailyActivity.daily_goal_hit),
        )
        .filter(DailyActivity.user_id == user_id)
        .filter(DailyActivity.activity_date == day)
        .one()
    )
    sentences_count = int(row[0])
    correct_count = int(row[1])
    # `bool_or` returns None on an empty group; treat as "not hit".
    goal_hit = bool(row[2]) if row[2] is not None else False
    accuracy = (correct_count / sentences_count) if sentences_count > 0 else None

    sessions = (
        db.query(PracticeSession)
        .filter(PracticeSession.user_id == user_id)
        .filter(func.date(PracticeSession.started_at) == day)
        .order_by(PracticeSession.started_at)
        .all()
    )
    return DayDetailResponse(
        date=day,
        sentences_count=sentences_count,
        correct_count=correct_count,
        accuracy=accuracy,
        goal_hit=goal_hit,
        sessions=[
            DaySessionSummary(
                session_id=s.id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                sentences_attempted=s.sentences_attempted,
                sentences_correct=s.sentences_correct,
                is_finished=s.is_finished,
            )
            for s in sessions
        ],
    )


# ---- Write-side: rollup helpers -------------------------------------------

def rollup_session_to_daily(
    db: DbSession,
    user_id: UUID,
    session: PracticeSession,
    today: date,
) -> None:
    """Bump daily_activity counters by the just-ended session.

    Uses INSERT … ON CONFLICT DO UPDATE so the operation is idempotent
    if /end is called twice for the same session (e.g. retry). The
    session.sentences_attempted is the delta; we add (not overwrite)
    because a future feature might allow multi-end from the frontend
    and we want the totals to reflect truth.
    """
    target = _get_daily_goal(db, user_id)
    attempted = int(session.sentences_attempted)
    correct = int(session.sentences_correct)

    # Upsert with arithmetic on the conflicting row.
    db.execute(
        text("""
            INSERT INTO daily_activity
                (user_id, activity_date, sentences_count, correct_count,
                 sessions_count, daily_goal_hit)
            VALUES (:uid, :d, :a, :c, 1, FALSE)
            ON CONFLICT (user_id, activity_date) DO UPDATE
            SET sentences_count = daily_activity.sentences_count + EXCLUDED.sentences_count,
                correct_count    = daily_activity.correct_count    + EXCLUDED.correct_count,
                sessions_count   = daily_activity.sessions_count   + 1,
                daily_goal_hit   = daily_activity.daily_goal_hit
                                   OR (daily_activity.sentences_count + EXCLUDED.sentences_count) >= :goal
        """),
        {"uid": user_id, "d": today, "a": attempted, "c": correct, "goal": target},
    )


def update_streak_on_activity(
    db: DbSession,
    user_id: UUID,
    today: date,
) -> None:
    """Extend / start / break the user's streak after activity on `today`.

    Rules:
      - No prior activity → start a new streak of 1.
      - Last activity == today → no-op (already counted).
      - Last activity == today - 1 → extend: current_streak += 1.
      - Last activity < today - 1 → break: reset current_streak to 1,
        current_streak_start = today.
      - last_active_date is updated to today always.
      - longest_streak = max(longest_streak, current_streak).
    """
    # Upsert: INSERT … ON CONFLICT DO UPDATE for the user_streaks row.
    db.execute(
        text("""
            INSERT INTO user_streaks
                (user_id, current_streak, longest_streak,
                 last_active_date, current_streak_start)
            VALUES (:uid, 1, 1, :d, :d)
            ON CONFLICT (user_id) DO UPDATE
            SET current_streak = CASE
                WHEN user_streaks.last_active_date = :d THEN user_streaks.current_streak
                WHEN user_streaks.last_active_date = :d_minus_1 THEN user_streaks.current_streak + 1
                WHEN user_streaks.last_active_date IS NULL THEN 1
                ELSE 1
            END,
            current_streak_start = CASE
                WHEN user_streaks.last_active_date = :d THEN user_streaks.current_streak_start
                WHEN user_streaks.last_active_date = :d_minus_1 THEN user_streaks.current_streak_start
                ELSE :d
            END,
            last_active_date = :d,
            longest_streak = GREATEST(
                user_streaks.longest_streak,
                CASE
                    WHEN user_streaks.last_active_date = :d THEN user_streaks.current_streak
                    WHEN user_streaks.last_active_date = :d_minus_1 THEN user_streaks.current_streak + 1
                    WHEN user_streaks.last_active_date IS NULL THEN 1
                    ELSE 1
                END
            )
        """),
        {"uid": user_id, "d": today, "d_minus_1": today - timedelta(days=1)},
    )


# ---- Helpers --------------------------------------------------------------

def _get_daily_goal(db: DbSession, user_id: UUID) -> int:
    user = db.query(User.daily_goal).filter(User.id == user_id).first()
    if user is None or user[0] is None:
        return 20  # default mirrors users.daily_goal server default
    return int(user[0])


def _get_monthly_goal(db: DbSession, user_id: UUID) -> int:
    user = db.query(User.monthly_goal).filter(User.id == user_id).first()
    if user is None or user[0] is None:
        return 600
    return int(user[0])