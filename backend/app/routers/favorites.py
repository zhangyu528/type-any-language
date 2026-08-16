"""
Favorites router — /api/favorites.

Server-side collection (was localStorage-only, see migration 0015).

Endpoints:
  GET  /api/favorites                  list the user's sentences + words
  POST /api/favorites                  add a sentence (and its word) or a word
  DELETE /api/favorites/sentence/{id}  remove a sentence — also drops all the
                                        user's word rows (1:1 binding)
  DELETE /api/favorites/word/{word}    remove a single word

Idempotency: adds use INSERT ... ON CONFLICT DO NOTHING against the
partial unique indexes, so re-adding an already-favorited item is a
no-op (matches the legacy localStorage "duplicate add is no-op"
behavior). Auth-required via get_current_user.

The 1:1 sentence↔word binding: POST with item_type='sentence' and a
word_text also inserts the word row, so the two stay in lockstep.
DELETE /sentence/{id} clears every word row for the user (mirrors
legacy removeFromCollection, which set c.words = {}).
"""
from __future__ import annotations

import uuid
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.deps.auth import get_current_user
from app.models.favorite import UserFavorite
from app.models.user import User

router = APIRouter(prefix="/api/favorites", tags=["favorites"])


class AddRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    item_type: str  # 'sentence' | 'word'
    sentence_id: Optional[UUID] = None
    word_text: Optional[str] = None
    lib_id: Optional[UUID] = None


class FavoriteSentenceOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    sentence_id: UUID
    lib_id: Optional[UUID] = None
    added_at: str


class FavoriteWordOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    word: str
    added_at: str


class FavoritesOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    sentences: list[FavoriteSentenceOut]
    words: list[FavoriteWordOut]


def _norm_word(word: Optional[str]) -> Optional[str]:
    return word.strip().lower() if word else None


@router.get("", response_model=FavoritesOut)
def list_favorites(
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> FavoritesOut:
    rows = (
        db.query(UserFavorite)
        .filter(UserFavorite.user_id == current_user.id)
        .all()
    )
    sentences: list[FavoriteSentenceOut] = []
    words: list[FavoriteWordOut] = []
    for r in rows:
        if r.item_type == "sentence" and r.sentence_id is not None:
            sentences.append(
                FavoriteSentenceOut(
                    sentence_id=r.sentence_id,
                    lib_id=r.lib_id,
                    added_at=r.created_at.isoformat(),
                )
            )
        elif r.item_type == "word" and r.word_text:
            words.append(
                FavoriteWordOut(word=r.word_text, added_at=r.created_at.isoformat())
            )
    return FavoritesOut(sentences=sentences, words=words)


@router.post("", status_code=204)
def add_favorite(
    payload: AddRequest,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> Response:
    uid = str(current_user.id)
    if payload.item_type == "sentence":
        if payload.sentence_id is None:
            raise HTTPException(status_code=422, detail="sentence_id required")
        db.execute(
            text(
                "INSERT INTO user_favorites (id, user_id, item_type, sentence_id, lib_id, created_at) "
                "VALUES (:id, :uid, 'sentence', :sid, :lib, now()) "
                "ON CONFLICT (user_id, sentence_id) "
                "WHERE item_type = 'sentence' AND sentence_id IS NOT NULL DO NOTHING"
            ),
            {
                "id": str(uuid.uuid4()),
                "uid": uid,
                "sid": str(payload.sentence_id),
                "lib": str(payload.lib_id) if payload.lib_id else None,
            },
        )
        # The 1:1 binding: also record the word so the words tab stays
        # in lockstep with the sentence tab.
        word = _norm_word(payload.word_text)
        if word:
            db.execute(
                text(
                    "INSERT INTO user_favorites (id, user_id, item_type, word_text, created_at) "
                    "VALUES (:id, :uid, 'word', :w, now()) "
                    "ON CONFLICT (user_id, word_text) "
                    "WHERE item_type = 'word' AND word_text IS NOT NULL DO NOTHING"
                ),
                {"id": str(uuid.uuid4()), "uid": uid, "w": word},
            )
    elif payload.item_type == "word":
        word = _norm_word(payload.word_text)
        if not word:
            raise HTTPException(status_code=422, detail="word_text required")
        db.execute(
            text(
                "INSERT INTO user_favorites (id, user_id, item_type, word_text, created_at) "
                "VALUES (:id, :uid, 'word', :w, now()) "
                "ON CONFLICT (user_id, word_text) "
                "WHERE item_type = 'word' AND word_text IS NOT NULL DO NOTHING"
            ),
            {"id": str(uuid.uuid4()), "uid": uid, "w": word},
        )
    else:
        raise HTTPException(status_code=422, detail="invalid item_type")
    db.commit()
    return Response(status_code=204)


@router.delete("/sentence/{sentence_id}", status_code=204)
def remove_sentence(
    sentence_id: UUID,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> Response:
    uid = str(current_user.id)
    # Remove the sentence row + every word row (1:1 binding).
    db.execute(
        text(
            "DELETE FROM user_favorites "
            "WHERE user_id = :uid AND item_type = 'sentence' AND sentence_id = :sid"
        ),
        {"uid": uid, "sid": str(sentence_id)},
    )
    db.execute(
        text("DELETE FROM user_favorites WHERE user_id = :uid AND item_type = 'word'"),
        {"uid": uid},
    )
    db.commit()
    return Response(status_code=204)


@router.delete("/word/{word}", status_code=204)
def remove_word(
    word: str,
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> Response:
    w = _norm_word(word)
    if not w:
        return Response(status_code=204)
    db.execute(
        text(
            "DELETE FROM user_favorites "
            "WHERE user_id = :uid AND item_type = 'word' AND word_text = :w"
        ),
        {"uid": str(current_user.id), "w": w},
    )
    db.commit()
    return Response(status_code=204)
