"""
Content catalog endpoint — powers the frontend library + difficulty picker.

Single GET: returns every vocabulary lib, each lib's available difficulty
buckets, and the UI defaults. Phase 1 sources libs from the DB and
hardcodes the difficulty list per Phase 1's scope. Phase 2 will source
per-lib difficulty lists from a DB column populated by import_vocab from
cms/seed/manifest.yaml.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.vocabulary import VocabularyLib
from app.schemas.content import CatalogDefaults, CatalogLib, CatalogResponse

router = APIRouter(prefix="/api/content", tags=["content"])


# Phase 1: same three buckets for every lib. This matches what the DB
# currently holds (legacy DIFFICULTIES list). Replaced by per-lib column
# data in Phase 2.
_PHASE1_DIFFICULTIES = ("beginner", "intermediate", "advanced")


@router.get("/catalog", response_model=CatalogResponse)
def get_catalog(db: Session = Depends(get_db)):
    """Single endpoint powering the frontend library + difficulty picker.

    Returns every vocabulary lib, each lib's available difficulty buckets,
    and the UI defaults (used when the user has no prior selection in
    localStorage).
    """
    libs = db.query(VocabularyLib).order_by(VocabularyLib.level).all()
    return CatalogResponse(
        libs=[CatalogLib.model_validate(lib) for lib in libs],
        difficulties_by_lib={lib.level: list(_PHASE1_DIFFICULTIES) for lib in libs},
        defaults=CatalogDefaults(difficulty="beginner", bucket_target_size=200),
    )