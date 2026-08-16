"""
Review router — /api/review/candidates.

The "复习" sidebar surface. Returns the sentences the user should review
today, as a single ready-to-render payload (text + chinese + audio):

  - wrong: sentences the user answered incorrectly in the last
    `window_days` days (from practice_attempts, default 14, configurable
    on the settings page). These are the highest-priority review
    items — the ones they've been getting wrong.
  - favorite: the user's cloud-favorited sentences (from user_favorites).
    Surfacing favorites here keeps "starred to remember" items in the
    practice loop without a separate SRS schedule.

The two sets are merged and de-duplicated by sentence_id; a sentence
that is both wrong AND favorited is labelled 'favorite' (so the review
queue reads as "things you care about" rather than "your mistakes").

This is an MVP review source: a true spaced-repetition scheduler
(per-sentence ease / interval) can layer on top of practice_attempts
later without changing this endpoint's contract.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/review", tags=["review"])

# How far back a "wrong" attempt is still worth reviewing.
REVIEW_WINDOW_DAYS = 14


def count_review_due(
    db: DbSession,
    user_id: object,
    window_days: int = REVIEW_WINDOW_DAYS,
) -> int:
    """Count distinct sentences the user should review today.

    Mirrors the candidate set in review_candidates() but returns only the
    COUNT (no text/audio JOIN), so the dashboard can show a "N 句待复习"
    badge in its single-shot payload without re-pulling the full list.

    Set = (wrong attempts in the last `window_days`) UNION (cloud-favorited
    sentences), de-duplicated by sentence_id.
    """
    uid = str(user_id)
    row = db.execute(
        text(
            "SELECT COUNT(*) FROM ("
            "  SELECT DISTINCT sentence_id FROM practice_attempts "
            "  WHERE user_id = :uid AND correct = false "
            "    AND attempted_at > now() - make_interval(days => :days) "
            "    AND sentence_id IS NOT NULL "
            "  UNION "
            "  SELECT DISTINCT sentence_id FROM user_favorites "
            "  WHERE user_id = :uid AND item_type = 'sentence' "
            "    AND sentence_id IS NOT NULL"
            ") sub"
        ),
        {"uid": uid, "days": window_days},
    ).fetchone()
    return int(row[0]) if row else 0


@router.get("/candidates")
def review_candidates(
    limit: int = Query(default=50, ge=1, le=200),
    window_days: int = Query(default=REVIEW_WINDOW_DAYS, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    uid = str(current_user.id)

    wrong_rows = db.execute(
        text(
            "SELECT DISTINCT sentence_id, lib_id FROM practice_attempts "
            "WHERE user_id = :uid AND correct = false "
            "AND attempted_at > now() - make_interval(days => :days)"
        ),
        {"uid": uid, "days": window_days},
    ).fetchall()

    fav_rows = db.execute(
        text(
            "SELECT sentence_id, lib_id FROM user_favorites "
            "WHERE user_id = :uid AND item_type = 'sentence' "
            "AND sentence_id IS NOT NULL"
        ),
        {"uid": uid},
    ).fetchall()

    reasons: dict[str, str] = {}
    ordered_ids: list[UUID] = []
    for sid, _lib in wrong_rows:
        key = str(sid)
        reasons[key] = "wrong"
        ordered_ids.append(sid)
    for sid, _lib in fav_rows:
        key = str(sid)
        if key not in reasons:
            reasons[key] = "favorite"
        if sid not in ordered_ids:
            ordered_ids.append(sid)

    if not ordered_ids:
        return {"candidates": []}

    sent_rows = db.execute(
        text(
            "SELECT id, lib_id, text, chinese_text, audio_url "
            "FROM sentences WHERE id = ANY(:ids::uuid[])"
        ),
        {"ids": [str(i) for i in ordered_ids]},
    ).fetchall()

    candidates = []
    for r in sent_rows:
        sid = str(r[0])
        candidates.append(
            {
                "sentence_id": sid,
                "lib_id": str(r[1]) if r[1] is not None else None,
                "text": r[2],
                "chinese_text": r[3],
                "audio_url": r[4],
                "reason": reasons.get(sid, "favorite"),
            }
        )
        if len(candidates) >= limit:
            break

    return {"candidates": candidates}
