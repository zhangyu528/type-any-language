"""
content/tools/cms/env.py — shared .env.db loader for the data pipeline.

Reads .env.db from the project root and exposes a typed `Config` object
to the other pipeline modules. Centralising the env-loading logic here
means individual scripts (import_vocab, generate_sentences, ...) can just
do `from cms.env import load_config; cfg = load_config()` and
get validated settings.

Why a dedicated loader (not os.environ directly):
  - Fail loudly if .env.db is missing or required keys are unset.
  - Single place to do type coercion + default handling.
  - Other scripts can `from cms.env import setup_env` to mirror
    the .env.db → os.environ copy that bake_image.sh does via `set -a`.

Validation contract:
  - DATABASE_URL is ALWAYS required (assembled by setup_env from
    POSTGRES_PASSWORD + code defaults). load_config() raises if it's
    missing — every subcommand needs the DB.
  - AI_API_KEY / AI_BASE_URL / AI_MODEL are OPTIONAL at load time.
    Each is `str | None`. Consumer modules that talk to OpenAI should
    call `cfg.require_ai()` first, which raises with a clear pointer
    to .env.db and the specific subcommand that needs them.
  - TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID are also
    OPTIONAL. Consumer modules for Tencent TTS call `cfg.require_tencent()`
    first.
  - Rationale: a CMS host that only runs `content.sh sync` doesn't need
    AI or TENCENT keys at all. Forcing them on every operator is friction;
    forcing them only on the subcommand that needs them is the right
    shape. The bash-side `env.sh doctor` and `content.sh doctor` already
    treat AI as required and TENCENT as optional — this Python change
    brings the two sides into agreement.

Usage from a CLI script:
    from cms.env import setup_env, load_config
    setup_env()                 # copies .env.db into os.environ (idempotent)
    cfg = load_config()         # typed Config (AI / TENCENT fields may be None)
    cfg.require_ai()            # raise if AI_* unset — call this before OpenAI calls
    cfg.require_tencent()       # raise if TENCENT_* unset — call this before TTS calls
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote


# Project root = parent of content/. Caller passes an absolute path or we
# fall back to a walk-up from this file (parent of content/tools/cms/).
def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


# ---------------------------------------------------------------------------
# Postgres connection assembly
# ---------------------------------------------------------------------------
# Code defaults for the Postgres connection. Each can be overridden by an
# env var (set in the shell, or by .env.db via setup_env):
#   POSTGRES_USER   -> english_user       (matches POSTGRES_USER in the baked image label)
#   POSTGRES_DB     -> english_learning   (matches POSTGRES_DB   in the baked image label)
#   POSTGRES_HOST   -> localhost          (CMS host talking to its own / dev / prod db)
#   POSTGRES_PORT   -> 5432
# POSTGRES_PASSWORD has no default — it must be supplied. Sources (in order):
#   1. POSTGRES_PASSWORD env var
#   2. .secrets/postgres_password file (chmod 600, the same file the dev/prod
#      run.sh writes; operator copies it to the CMS host for content production)
#   3. error
# If DATABASE_URL is already set in the environment (legacy or override),
# it's respected as-is — the assembly step is a no-op.

_DEFAULT_POSTGRES_USER = "english_user"
_DEFAULT_POSTGRES_DB = "english_learning"
_DEFAULT_POSTGRES_HOST = "localhost"
_DEFAULT_POSTGRES_PORT = "5432"


def _resolve_postgres_password() -> str:
    """Find the per-host postgres password. Order:
        1. POSTGRES_PASSWORD env var
        2. .secrets/postgres_password file (relative to project root)
        3. error
    """
    pwd = os.environ.get("POSTGRES_PASSWORD", "").strip()
    if pwd:
        return pwd
    secret_file = _project_root() / ".secrets" / "postgres_password"
    if secret_file.is_file():
        pwd = secret_file.read_text(encoding="utf-8").strip()
        if pwd:
            return pwd
    sys.exit(
        "POSTGRES_PASSWORD missing — set it via:\n"
        "  export POSTGRES_PASSWORD=...\n"
        "  # OR copy the per-host password file from the dev/prod host:\n"
        "  mkdir -p .secrets && scp user@dev-host:.secrets/postgres_password .secrets/"
    )


def _resolve_database_url() -> str:
    """Return the full DATABASE_URL, either from env or assembled from parts.

    Priority: explicit DATABASE_URL env var > assembled from code defaults
    + POSTGRES_PASSWORD.
    """
    explicit = os.environ.get("DATABASE_URL", "").strip()
    if explicit:
        return explicit
    user = os.environ.get("POSTGRES_USER", _DEFAULT_POSTGRES_USER)
    db = os.environ.get("POSTGRES_DB", _DEFAULT_POSTGRES_DB)
    host = os.environ.get("POSTGRES_HOST", _DEFAULT_POSTGRES_HOST)
    port = os.environ.get("POSTGRES_PORT", _DEFAULT_POSTGRES_PORT)
    pwd = _resolve_postgres_password()
    return f"postgresql://{quote(user, safe='')}:{quote(pwd, safe='')}@{host}:{port}/{db}"


def setup_env(env_file: str | os.PathLike | None = None) -> dict[str, str]:
    """Load .env.db into os.environ (idempotent). Returns the loaded dict.

    Mirrors what bake_image.sh does in bash:
        set -a; . ./.env.db; set +a

    After this call:
      - os.environ["DATABASE_URL"] is populated (either from .env.db or
        assembled from POSTGRES_PASSWORD + code defaults) so downstream
        libraries (psycopg2, openai, tencentcloud-sdk-python) can pick
        them up via their standard env-var discovery.
      - os.environ["AI_API_KEY"] and "TENCENT_*" are populated if they're
        in .env.db (those are the only required secrets now).
    """
    path = Path(env_file) if env_file else _project_root() / ".env.db"
    if not path.is_file():
        sys.exit(
            f".env.db 不存在 ({path}) — 跑 ./scripts/ops/content/env.sh 先引导"
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

    # Assemble DATABASE_URL last so it picks up POSTGRES_PASSWORD / .secrets
    # / explicit override correctly. If .env.db already set it, that's used.
    assembled = _resolve_database_url()
    os.environ["DATABASE_URL"] = assembled
    loaded["DATABASE_URL"] = assembled
    return loaded


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"required env var {name} is missing — check .env.db")
    return value


@dataclass(frozen=True)
class Config:
    """Validated .env.db settings used by the data pipeline.

    AI_* and TENCENT_* fields are Optional — each is None if the
    corresponding .env.db key was missing or empty. Consumer modules
    that actually need them should call `cfg.require_ai()` or
    `cfg.require_tencent()` first, which raises with a clear pointer
    to which subcommand needs which keys.
    """

    # Database (assembled from POSTGRES_PASSWORD + code defaults by setup_env).
    # Always required — every subcommand needs the DB.
    database_url: str

    # AI / OpenAI — Optional; required only for `content.sh sentences`.
    ai_api_key: str | None
    ai_base_url: str | None
    ai_model: str | None

    # Tencent TTS — Optional; required only for `content.sh audio`.
    tencent_secret_id: str | None
    tencent_secret_key: str | None
    tencent_app_id: str | None

    # Audio
    audio_dir: str

    # Tuning
    default_bucket_target_size: int

    # Bake identity (consumed by export_bundle.py via env, not here)
    postgres_user: str
    postgres_db: str

    def require_ai(self) -> None:
        """Raise if any AI_* field is unset. Call before OpenAI requests.

        Error message names the specific subcommand that needs these
        keys, so the operator knows where to look.
        """
        missing = [
            name for name, val in (
                ("AI_API_KEY",  self.ai_api_key),
                ("AI_BASE_URL", self.ai_base_url),
                ("AI_MODEL",    self.ai_model),
            ) if not val
        ]
        if missing:
            sys.exit(
                f"{', '.join(missing)} missing in .env.db — "
                f"required for `content.sh sentences`"
            )

    def require_tencent(self) -> None:
        """Raise if any TENCENT_* field is unset. Call before Tencent TTS.

        TENCENT_* is all-or-nothing: the .env.example.db template leaves
        them empty (audio subcommand is optional), but if you set any,
        you must set all three.
        """
        missing = [
            name for name, val in (
                ("TENCENT_SECRET_ID",  self.tencent_secret_id),
                ("TENCENT_SECRET_KEY", self.tencent_secret_key),
                ("TENCENT_APP_ID",     self.tencent_app_id),
            ) if not val
        ]
        if missing:
            sys.exit(
                f"{', '.join(missing)} missing in .env.db — "
                f"required for `content.sh audio`. "
                f"Either fill all three TENCENT_* keys, or skip the audio subcommand."
            )


# Where TTS MP3s land before bake. XDG-style: /var/lib/<app>/<resource>.
# generate_audio.py creates the dir (mkdir -p), so the only thing the
# operator needs is write access to /var/lib. On systems where that's
# not practical (Windows, no sudo), set AUDIO_DIR via shell env when
# running content.sh / bake_image.sh.
_DEFAULT_AUDIO_DIR = "/var/lib/type-any-language/audio"


def load_config() -> Config:
    """Build a Config from os.environ.

    Required keys (no defaults — fail if missing):
      DATABASE_URL (assembled by setup_env from POSTGRES_PASSWORD + code defaults).

    Optional keys (None if missing/empty): AI_API_KEY, AI_BASE_URL, AI_MODEL,
    TENCENT_SECRET_ID, TENCENT_SECRET_KEY, TENCENT_APP_ID. Consumer modules
    that need them call cfg.require_ai() / cfg.require_tencent() at point
    of use, with a clear error pointing at the specific subcommand that
    needs the missing keys.

    Defaults provided for AUDIO_DIR, DEFAULT_BUCKET_TARGET_SIZE,
    POSTGRES_USER, POSTGRES_DB.
    """
    return Config(
        database_url=_required("DATABASE_URL"),
        # AI / Tencent are read raw — None means "operator hasn't set
        # them in .env.db". load_config must NOT fail on these, because
        # sync / export don't need them. require_ai() / require_tencent()
        # enforce at point of use.
        ai_api_key=os.environ.get("AI_API_KEY") or None,
        ai_base_url=os.environ.get("AI_BASE_URL") or None,
        ai_model=os.environ.get("AI_MODEL") or None,
        tencent_secret_id=os.environ.get("TENCENT_SECRET_ID") or None,
        tencent_secret_key=os.environ.get("TENCENT_SECRET_KEY") or None,
        tencent_app_id=os.environ.get("TENCENT_APP_ID") or None,
        audio_dir=os.environ.get("AUDIO_DIR", _DEFAULT_AUDIO_DIR),
        default_bucket_target_size=int(
            os.environ.get("DEFAULT_BUCKET_TARGET_SIZE", "200")
        ),
        postgres_user=os.environ.get("POSTGRES_USER", _DEFAULT_POSTGRES_USER),
        postgres_db=os.environ.get("POSTGRES_DB", _DEFAULT_POSTGRES_DB),
    )