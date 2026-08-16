from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID


class CatalogLib(BaseModel):
    id: UUID
    name: str
    level: str
    word_count: int
    # Total sentences in this lib (across all difficulty buckets).
    # 0 for libs that don't have any — UI should hide the stat then.
    sentence_count: int = 0
    description: Optional[str] = None  # nullable; from manifest on bake
    # Course-catalog metadata (the "练习" partition became a browsable
    # course catalog). A vocabulary lib is course_type="vocab"; future
    # grammar / listening / exam courses use the same surface.
    course_type: str = "vocab"
    category: Optional[str] = None
    accent: Optional[str] = None  # color token: blue/green/amber/purple
    lesson_count: Optional[int] = None
    est_minutes: Optional[int] = None
    order_index: int = 0
    is_published: bool = True

    class Config:
        from_attributes = True


class CatalogDefaults(BaseModel):
    difficulty: str
    bucket_target_size: int


class CatalogResponse(BaseModel):
    """Returned by GET /api/cms/catalog.

    libs:                  every vocabulary lib the runtime has, in stable order.
    difficulties_by_lib:   the difficulty buckets each lib offers. Keys are lib.level.
                           Phase 1 returns the same three for every lib (matches what
                           the DB currently contains). Phase 2 will source per-lib
                           lists from a DB column populated by import_vocab from the
                           manifest -- so a `business` lib can ship `[beginner,
                           intermediate]` only.
    defaults:              UI fallback when the user has no prior selection.
    """
    libs: List[CatalogLib]
    difficulties_by_lib: dict[str, List[str]]
    defaults: CatalogDefaults