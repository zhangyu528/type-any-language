"""
Weakness router — /api/weakness.

Data-driven replacement for the old manual "收藏" (favorites) surface.
The product decision: users don't curate a collection by hand; the app
records weakness automatically from error rate. This endpoint aggregates
practice_attempts (the per-sentence correct/incorrect log, migration
0016) and joins sentences to surface *what* the user keeps getting wrong:

  - weak_sentences: the sentences with the most wrong attempts (with text
    + chinese + target_words so the UI can render + drill them).
  - weak_words:     wrong-attempt counts rolled up by target_word, so the
    user sees "these specific words trip you up".
  - weak_topics:    wrong-attempt counts by sentence.topic.
  - weak_cefr:      wrong-attempt counts by sentence.cefr.
  - totals:         lifetime attempts / wrong / accuracy for the header.

All aggregates are wrong-attempt-weighted (a sentence you got wrong 5× of
6 counts more than one you got wrong 1× of 10), which is the signal the
review queue already uses. Pure read, auth-required.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/weakness", tags=["weakness"])


@router.get("")
def get_weakness(
    limit: int = Query(default=15, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Return the user's weak points, aggregated from practice_attempts.

    Only sentences the user has answered incorrectly at least once are
    returned; a sentence answered correctly every time is, by definition,
    not a weak point.
    """
    uid = str(current_user.id)

    rows = db.execute(
        text(
            """
            SELECT s.id, s.lib_id, s.text, s.chinese_text, s.target_words,
                   s.topic, s.cefr,
                   COUNT(*) FILTER (WHERE pa.correct = false) AS wrong,
                   COUNT(*) AS total
            FROM practice_attempts pa
            JOIN sentences s ON s.id = pa.sentence_id
            WHERE pa.user_id = :uid AND pa.sentence_id IS NOT NULL
            GROUP BY s.id
            HAVING COUNT(*) FILTER (WHERE pa.correct = false) > 0
            ORDER BY wrong DESC,
                     (COUNT(*) FILTER (WHERE pa.correct = false))::float
                       / COUNT(*) DESC
            LIMIT :lim
            """
        ),
        {"uid": uid, "lim": limit},
    ).fetchall()

    weak_sentences: List[dict] = []
    word_counts: dict[str, int] = {}
    topic_counts: dict[str, int] = {}
    cefr_counts: dict[str, int] = {}
    total_wrong = 0
    total_attempts = 0

    for r in rows:
        (
            sid,
            lib_id,
            text_val,
            chinese_text,
            target_words,
            topic,
            cefr,
            wrong,
            total,
        ) = r
        wrong = int(wrong)
        total = int(total)
        total_wrong += wrong
        total_attempts += total

        weak_sentences.append(
            {
                "sentence_id": str(sid),
                "lib_id": str(lib_id) if lib_id is not None else None,
                "text": text_val,
                "chinese_text": chinese_text,
                "target_words": list(target_words) if target_words else [],
                "wrong_count": wrong,
                "attempts": total,
                "error_rate": round(wrong / total, 3) if total else 0.0,
            }
        )

        for w in target_words or []:
            word_counts[w] = word_counts.get(w, 0) + wrong
        if topic:
            topic_counts[topic] = topic_counts.get(topic, 0) + wrong
        if cefr:
            cefr_counts[cefr] = cefr_counts.get(cefr, 0) + wrong

    weak_words = sorted(
        ({"word": w, "wrong": c} for w, c in word_counts.items()),
        key=lambda x: x["wrong"],
        reverse=True,
    )[:20]
    weak_topics = sorted(
        ({"topic": t, "wrong": c} for t, c in topic_counts.items()),
        key=lambda x: x["wrong"],
        reverse=True,
    )
    weak_cefr = sorted(
        ({"cefr": c, "wrong": n} for c, n in cefr_counts.items()),
        key=lambda x: x["wrong"],
        reverse=True,
    )

    return {
        "weak_sentences": weak_sentences,
        "weak_words": weak_words,
        "weak_topics": weak_topics,
        "weak_cefr": weak_cefr,
        "totals": {
            "wrong": total_wrong,
            "attempts": total_attempts,
            "accuracy": round(1 - total_wrong / total_attempts, 3)
            if total_attempts
            else None,
        },
    }
