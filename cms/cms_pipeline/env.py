"""
cms/cms_pipeline/env.py — typed Config loader for the data pipeline.

Reads every value from `os.environ` (populated by
`scripts/secrets/fetch_secrets.sh eval-cms` on a workstation) and
exposes a typed `Config` object to the other pipeline modules.
Centralising the env-reading logic here means individual scripts
(import_vocab, generate_sentences, ...) can just do
`from cms_pipeline.env import load_config; cfg = load_config()` and
get validated settings.

Validation contract:
  - DATABASE_URL / POSTGRES_PASSWORD are NOT touched here. CMS modules
    do not connect to the database — they only write files to
    cms/content/. The db side (db/scripts/bootstrap_tencent.sh /
    init_schema.sh / migrate.sh / import_staging.sh) resolves DATABASE_URL
    itself from shell env or .secrets/database_url before invoking
    db-side Python.
  - AI_API_KEY / AI_BASE_URL / AI_MODEL are OPTIONAL at load time.
    Each is `str | None`. Consumer modules that talk to OpenAI should
    call `cfg.require_ai()` first, which raises with a clear pointer
    to the env var name and the specific subcommand that needs it.
  - TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID are also
    OPTIONAL. Consumer modules for Tencent TTS call
    `cfg.require_tencent()` first.
  - CLOUD_* are OPTIONAL. Required only when CLOUD_PROVIDER is
    non-default. Consumer modules (cms.storage) call
    `cfg.require_cloud()` first.
  - Rationale: a CMS host that only runs `staging.sh vocab` doesn't need
    AI or TENCENT keys at all. Forcing them on every operator is
    friction; forcing them only on the subcommand that needs them is
    the right shape.

Usage from a CLI script:
    from cms_pipeline.env import load_config
    cfg = load_config()         # typed Config (AI / TENCENT fields may be None)
    cfg.require_ai()            # raise if AI_* unset — call this before OpenAI calls
    cfg.require_tencent()       # raise if TENCENT_* unset — call this before TTS calls
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    """Validated process-environment settings used by the data pipeline.

    AI_* / TENCENT_* / CLOUD_* fields are Optional — each is None if the
    corresponding env var was missing or empty. Consumer modules that
    actually need them should call `cfg.require_ai()` /
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
    # files. git-tracked; consumed by db/scripts/import_staging.sh on
    # any host with DATABASE_URL (typically the CMS host).
    content_dir: str

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
                f"{', '.join(missing)} missing — required for "
                f"`staging.sh sentences`. Run "
                f"`eval \"$(scripts/secrets/fetch_secrets.sh eval-cms)\"` "
                f"or export the values in the current shell."
            )

    def require_tencent(self) -> None:
        """Raise if any TENCENT_* field is unset. Call before Tencent TTS.

        TENCENT_* is all-or-nothing: the GitHub Environment's keys may
        all be unset (audio subcommand is optional), but if any is set
        in the process env, all three must be present.
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
                f"{', '.join(missing)} missing — required for "
                f"`staging.sh audio`. Run "
                f"`eval \"$(scripts/secrets/fetch_secrets.sh eval-cms)\"` "
                f"or export the values in the current shell."
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
                f"{', '.join(missing)} missing — required for "
                f"CLOUD_PROVIDER={self.cloud_provider!r}. "
                f"Run `eval \"$(scripts/secrets/fetch_secrets.sh eval-cms)\"` "
                f"or set the CLOUD_* values in the current shell."
            )


# Where TTS MP3s land before bake. Lives inside the project so Windows
# users and sandboxed Linux hosts (no sudo, no write access to /var/lib)
# can run staging.sh audio without any extra setup. Operators override
# by setting AUDIO_DIR in the shell.
_DEFAULT_AUDIO_DIR = "cms/.local/audio"

# Where the CMS pipeline writes its output JSON/JSONL (vocabulary/*.json,
# sentences/*.jsonl, manifest.json). This directory IS git-tracked (see
# cms/.gitignore) — it's the "transmission layer" between CMS host and
# the db's L step. CMS writes here; db/scripts/import_staging.sh reads
# from here and UPSERTs into the cloud db.
#
# Override via CMS_CONTENT_DIR in the shell (rare; mostly for tests).
_DEFAULT_CONTENT_DIR = "cms/content"


def load_config() -> Config:
    """Build a Config from os.environ.

    Optional keys (None if missing/empty): AI_API_KEY, AI_BASE_URL, AI_MODEL,
    TENCENT_SECRET_ID, TENCENT_SECRET_KEY, TENCENT_APP_ID, CLOUD_*.
    Consumer modules that need them call cfg.require_ai() /
    cfg.require_tencent() / cfg.require_cloud() at point of use, with a
    clear error pointing at the specific subcommand that needs the
    missing keys.

    Defaults provided for AUDIO_DIR, CMS_CONTENT_DIR,
    DEFAULT_BUCKET_TARGET_SIZE.

    No DATABASE_URL / POSTGRES_* — CMS modules don't connect to the db.
    """
    return Config(
        # AI / Tencent are read raw — None means the operator hasn't
        # exported them in the shell (typically because
        # fetch_secrets.sh eval-cms wasn't run). load_config must NOT
        # fail on these, because sync doesn't need them. require_ai() /
        # require_tencent() enforce at point of use.
        ai_api_key=os.environ.get("AI_API_KEY") or None,
        ai_base_url=os.environ.get("AI_BASE_URL") or None,
        ai_model=os.environ.get("AI_MODEL") or None,
        tencent_secret_id=os.environ.get("TENCENT_SECRET_ID") or None,
        tencent_secret_key=os.environ.get("TENCENT_SECRET_KEY") or None,
        tencent_app_id=os.environ.get("TENCENT_APP_ID") or None,
        audio_dir=os.environ.get("AUDIO_DIR", _DEFAULT_AUDIO_DIR),
        content_dir=os.environ.get("CMS_CONTENT_DIR", _DEFAULT_CONTENT_DIR),
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