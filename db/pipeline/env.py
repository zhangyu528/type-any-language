"""
db/pipeline/env.py — shared .env.cms loader for the data pipeline.

Reads .env.cms from the project root and exposes a typed `Config` object
to the other pipeline modules. Centralising the env-loading logic here
means individual scripts (import_vocab, generate_sentences, ...) can just
do `from pipeline.env import load_config; cfg = load_config()` and
get validated settings.

Why a dedicated loader (not os.environ directly):
  - Fail loudly if .env.cms is missing or required keys are unset.
  - Single place to do type coercion + default handling.
  - Other scripts can `from pipeline.env import setup_env` to mirror
    the .env.cms → os.environ copy that bake_image.sh does via `set -a`.

Usage from a CLI script:
    from pipeline.env import setup_env, load_config
    setup_env()                 # copies .env.cms into os.environ (idempotent)
    cfg = load_config()         # typed, validated config
    print(cfg.ai_api_key)       # str (raises if missing)
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


# Project root = parent of db/. Caller passes an absolute path or we
# fall back to a walk-up from this file.
def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def setup_env(env_file: str | os.PathLike | None = None) -> dict[str, str]:
    """Load .env.cms into os.environ (idempotent). Returns the loaded dict.

    Mirrors what bake_image.sh does in bash:
        set -a; . ./.env.cms; set +a

    After this call, os.environ["DATABASE_URL"] etc. are populated and
    downstream libraries (psycopg2, openai, tencentcloud-sdk-python) can
    pick them up via their standard env-var discovery.
    """
    path = Path(env_file) if env_file else _project_root() / ".env.cms"
    if not path.is_file():
        sys.exit(
            f".env.cms 不存在 ({path}) — 跑 ./scripts/ops/db/env.sh 先引导"
        )

    loaded: dict[str, str] = {}
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # Strip optional surrounding quotes.
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            loaded[key] = value
            os.environ.setdefault(key, value)  # don't clobber pre-set env
    return loaded


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"required env var {name} is missing — check .env.cms")
    return value


@dataclass(frozen=True)
class Config:
    """Validated .env.cms settings used by the data pipeline."""

    # Database
    database_url: str

    # AI / OpenAI
    ai_api_key: str
    ai_base_url: str
    ai_model: str

    # Tencent TTS
    tencent_secret_id: str
    tencent_secret_key: str
    tencent_app_id: str

    # Audio
    audio_dir: str

    # Tuning
    default_bucket_target_size: int

    # Bake identity (consumed by export_bundle.py via env, not here)
    postgres_user: str
    postgres_db: str


def load_config() -> Config:
    """Build a validated Config from os.environ.

    Required keys (no defaults — fail if missing):
      DATABASE_URL, AI_API_KEY, TENCENT_SECRET_ID, TENCENT_SECRET_KEY,
      TENCENT_APP_ID, AUDIO_DIR.

    Defaults provided for AI_BASE_URL, AI_MODEL, DEFAULT_BUCKET_TARGET_SIZE.
    """
    return Config(
        database_url=_required("DATABASE_URL"),
        ai_api_key=_required("AI_API_KEY"),
        ai_base_url=os.environ.get("AI_BASE_URL", "https://api.openai.com/v1"),
        ai_model=os.environ.get("AI_MODEL", "gpt-3.5-turbo"),
        tencent_secret_id=_required("TENCENT_SECRET_ID"),
        tencent_secret_key=_required("TENCENT_SECRET_KEY"),
        tencent_app_id=_required("TENCENT_APP_ID"),
        audio_dir=_required("AUDIO_DIR"),
        default_bucket_target_size=int(
            os.environ.get("DEFAULT_BUCKET_TARGET_SIZE", "200")
        ),
        postgres_user=os.environ.get("POSTGRES_USER", "english_user"),
        postgres_db=os.environ.get("POSTGRES_DB", "english_learning"),
    )