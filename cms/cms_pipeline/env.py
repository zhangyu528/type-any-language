"""
cms/cms_pipeline/env.py — shared cms/.env loader for the data pipeline.

Reads cms/.env from the project root and exposes a typed `Config` object
to the other pipeline modules. Centralising the env-loading logic here
means individual scripts (import_vocab, generate_sentences, ...) can just
do `from cms_pipeline.env import load_config; cfg = load_config()` and
get validated settings.

Why a dedicated loader (not os.environ directly):
  - Fail loudly if cms/.env is missing or required keys are unset.
  - Single place to do type coercion + default handling.
  - Other scripts can `from cms_pipeline.env import setup_env` to mirror
    the cms/.env → os.environ copy that db scripts do via `set -a`.

Validation contract:
  - DATABASE_URL / POSTGRES_PASSWORD are NOT touched here. CMS modules
    do not connect to the database — they only write files to
    cms/staging/. The db side (db/scripts/source_db.sh / build.sh /
    migrate.sh) resolves the password itself from shell env or
    .secrets/postgres_password, and assembles DATABASE_URL before
    invoking db-side Python.
  - AI_API_KEY / AI_BASE_URL / AI_MODEL are OPTIONAL at load time.
    Each is `str | None`. Consumer modules that talk to OpenAI should
    call `cfg.require_ai()` first, which raises with a clear pointer
    to cms/.env and the specific subcommand that needs them.
  - TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID are also
    OPTIONAL. Consumer modules for Tencent TTS call `cfg.require_tencent()`
    first.
  - CLOUD_* are OPTIONAL. Required only when CLOUD_PROVIDER is non-default.
    Consumer modules (cms.storage) call `cfg.require_cloud()` first.
  - Rationale: a CMS host that only runs `staging.sh sync` doesn't need
    AI or TENCENT keys at all. Forcing them on every operator is friction;
    forcing them only on the subcommand that needs them is the right
    shape. The bash-side `env.sh doctor` and `staging.sh doctor` already
    treat AI as required and TENCENT as optional — this Python change
    brings the two sides into agreement.

Usage from a CLI script:
    from cms_pipeline.env import setup_env, load_config
    setup_env()                 # copies cms/.env into os.environ (idempotent)
    cfg = load_config()         # typed Config (AI / TENCENT fields may be None)
    cfg.require_ai()            # raise if AI_* unset — call this before OpenAI calls
    cfg.require_tencent()       # raise if TENCENT_* unset — call this before TTS calls
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


# Project root = parent of cms/. Caller passes an absolute path or we
# fall back to a walk-up from this file (parent of cms/cms_pipeline/).
def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def setup_env(env_file: str | os.PathLike | None = None) -> dict[str, str]:
    """Load cms/.env into os.environ (idempotent). Returns the loaded dict.

    Path resolution (highest priority first):
      1. Caller-supplied $env_file argument (absolute or project-root-relative)
      2. Shell env CONTENT_ENV_FILE (absolute or project-root-relative)
      3. Default: $PROJECT_ROOT/cms/.env

    Relative paths are resolved against the project root (parent of
    cms/). Absolute paths are used as-is.

    Why `cms/.env` (not project root): the only consumer of this file
    is the CMS content-production runtime. Co-locating it with `cms/`
    pairs with `cms/.local/audio` (audio staging dir) and lets the
    dev-host migrate sidecar reuse the existing `-v content:/content:ro`
    bind mount (no separate env-file mount needed).

    Mirrors what db scripts do in bash:
        set -a; . ./cms/.env; set +a

    After this call:
      - os.environ["AI_*"] / "TENCENT_*" / "CLOUD_*" / "AUDIO_DIR" /
        "CMS_STAGING_DIR" are populated from cms/.env if present.
      - POSTGRES_PASSWORD / DATABASE_URL are NOT touched here — CMS
        modules don't connect to the db.
    """
    if env_file is not None:
        path = Path(env_file)
    else:
        env_override = os.environ.get("CONTENT_ENV_FILE", "").strip()
        if env_override:
            path = Path(env_override)
            if not path.is_absolute():
                path = _project_root() / path
        else:
            path = _project_root() / "cms" / ".env"
    if not path.is_file():
        sys.exit(
            f"cms/.env 不存在 ({path}) — 跑 ./cms/scripts/env.sh 先引导"
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


@dataclass(frozen=True)
class Config:
    """Validated cms/.env settings used by the data pipeline.

    AI_* / TENCENT_* / CLOUD_* fields are Optional — each is None if the
    corresponding cms/.env key was missing or empty. Consumer modules
    that actually need them should call `cfg.require_ai()` /
    `cfg.require_tencent()` / `cfg.require_cloud()` first, which raises
    with a clear pointer to which subcommand needs which keys.

    No db fields (DATABASE_URL / POSTGRES_*) — CMS modules don't
    connect to the db.
    """

    # AI / OpenAI — Optional; required only for `staging.sh sentences`.
    ai_api_key: str | None
    ai_base_url: str | None
    ai_model: str | None

    # Tencent TTS — Optional; required only for `staging.sh audio`.
    tencent_secret_id: str | None
    tencent_secret_key: str | None
    tencent_app_id: str | None

    # Audio
    audio_dir: str

    # Staging output dir — where CMS writes vocabulary/sentences JSON+JSONL
    # files. git-tracked; consumed by db/scripts/import_staging.sh at bake time.
    staging_dir: str

    # Cloud storage — Optional. Required only when CLOUD_PROVIDER is
    # anything other than "local_fs" (the default). Consumer modules
    # (cms.storage) should call cfg.require_cloud() before instantiating
    # a non-default provider.
    cloud_provider: str | None
    cloud_bucket: str | None
    cloud_region: str | None
    cloud_access_key: str | None
    cloud_secret_key: str | None
    cloud_endpoint: str | None  # optional COS custom-domain / CDN

    # Tuning
    default_bucket_target_size: int

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
                f"{', '.join(missing)} missing in cms/.env — "
                f"required for `staging.sh sentences`"
            )

    def require_tencent(self) -> None:
        """Raise if any TENCENT_* field is unset. Call before Tencent TTS.

        TENCENT_* is all-or-nothing: the .env.example.cms template leaves
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
                f"{', '.join(missing)} missing in cms/.env — "
                f"required for `staging.sh audio`. "
                f"Either fill all three TENCENT_* keys, or skip the audio subcommand."
            )

    def require_cloud(self) -> None:
        """Raise if CLOUD_* fields are unset. Call before non-default
        storage providers. Same all-or-nothing pattern as require_tencent.
        """
        missing = [
            name for name, val in (
                ("CLOUD_BUCKET",      self.cloud_bucket),
                ("CLOUD_REGION",      self.cloud_region),
                ("CLOUD_ACCESS_KEY",  self.cloud_access_key),
                ("CLOUD_SECRET_KEY",  self.cloud_secret_key),
            ) if not val
        ]
        if missing:
            sys.exit(
                f"{', '.join(missing)} missing in cms/.env — "
                f"required for CLOUD_PROVIDER={self.cloud_provider!r}. "
                f"Set CLOUD_PROVIDER=local_fs to use the default local storage."
            )


# Where TTS MP3s land before bake. Lives inside the project so Windows
# users and sandboxed Linux hosts (no sudo, no write access to /var/lib)
# can run staging.sh audio without any extra setup. Operators override
# by setting AUDIO_DIR in cms/.env or the shell — the override wins
# over this default.
_DEFAULT_AUDIO_DIR = "cms/.local/audio"

# Where the CMS pipeline writes its output JSON/JSONL (vocabulary/*.json,
# sentences/*.jsonl, manifest.json). This directory IS git-tracked (see
# cms/.gitignore) — it's the "transmission layer" between CMS host and
# dev hosts. CMS writes here, dev pulls via git, dev runs
# db/scripts/import_staging.sh to UPSERT into the local staging db.
#
# Override via CMS_STAGING_DIR in the shell (rare; mostly for tests).
_DEFAULT_STAGING_DIR = "cms/staging"


def load_config() -> Config:
    """Build a Config from os.environ.

    Optional keys (None if missing/empty): AI_API_KEY, AI_BASE_URL, AI_MODEL,
    TENCENT_SECRET_ID, TENCENT_SECRET_KEY, TENCENT_APP_ID, CLOUD_*.
    Consumer modules that need them call cfg.require_ai() /
    cfg.require_tencent() / cfg.require_cloud() at point of use, with a
    clear error pointing at the specific subcommand that needs the
    missing keys.

    Defaults provided for AUDIO_DIR, CMS_STAGING_DIR,
    DEFAULT_BUCKET_TARGET_SIZE.

    No DATABASE_URL / POSTGRES_* — CMS modules don't connect to the db.
    """
    return Config(
        # AI / Tencent are read raw — None means "operator hasn't set
        # them in cms/.env". load_config must NOT fail on these, because
        # sync doesn't need them. require_ai() / require_tencent()
        # enforce at point of use.
        ai_api_key=os.environ.get("AI_API_KEY") or None,
        ai_base_url=os.environ.get("AI_BASE_URL") or None,
        ai_model=os.environ.get("AI_MODEL") or None,
        tencent_secret_id=os.environ.get("TENCENT_SECRET_ID") or None,
        tencent_secret_key=os.environ.get("TENCENT_SECRET_KEY") or None,
        tencent_app_id=os.environ.get("TENCENT_APP_ID") or None,
        audio_dir=os.environ.get("AUDIO_DIR", _DEFAULT_AUDIO_DIR),
        staging_dir=os.environ.get("CMS_STAGING_DIR", _DEFAULT_STAGING_DIR),
        # Cloud storage — default "local_fs" preserves the previous
        # "write to AUDIO_DIR" behavior. Other providers (tencent_cos)
        # require the operator to fill CLOUD_BUCKET / CLOUD_REGION /
        # CLOUD_ACCESS_KEY / CLOUD_SECRET_KEY; require_cloud() enforces.
        cloud_provider=os.environ.get("CLOUD_PROVIDER") or "local_fs",
        cloud_bucket=os.environ.get("CLOUD_BUCKET") or None,
        cloud_region=os.environ.get("CLOUD_REGION") or None,
        cloud_access_key=os.environ.get("CLOUD_ACCESS_KEY") or None,
        cloud_secret_key=os.environ.get("CLOUD_SECRET_KEY") or None,
        cloud_endpoint=os.environ.get("CLOUD_ENDPOINT") or None,
        default_bucket_target_size=int(
            os.environ.get("DEFAULT_BUCKET_TARGET_SIZE", "200")
        ),
    )