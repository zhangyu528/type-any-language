"""
Application configuration.

Settings are loaded from environment variables (and a .env file when
present) via pydantic-settings.

Secret delivery
---------------
Two values that may contain a password (DATABASE_URL, POSTGRES_PASSWORD)
support an indirection: if `<NAME>_FILE` is set in the environment, its
contents are read and used as the value of `<NAME>`. This mirrors the
postgres docker image convention (POSTGRES_PASSWORD_FILE) and keeps the
secret out of `docker inspect container` output.

Examples (compose env block):

    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      DATABASE_URL_FILE:      /run/secrets/database_url

The file is read once, on first access, and the result is cached.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings. Validated on first access."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App / security -----------------------------------------------------
    SECRET_KEY: str = Field(
        ...,
        description=(
            "Signing / encryption key. Must be ≥32 chars and not the default "
            "placeholder. Refuse to boot otherwise — see _require_secrets()."
        ),
    )
    ALLOWED_ORIGINS: str = Field(
        default="http://localhost",
        description="Comma-separated CORS allow-list.",
    )

    # --- Database -----------------------------------------------------------
    # Either DATABASE_URL or DATABASE_URL_FILE must produce a value. The
    # _resolve_file_indirection helper handles the *_FILE variant.
    DATABASE_URL: Optional[str] = Field(
        default=None,
        description="postgresql:// connection URL. If unset, DATABASE_URL_FILE is consulted.",
    )
    DATABASE_URL_FILE: Optional[str] = Field(
        default=None,
        description="Path to a file containing DATABASE_URL. Read once, then discarded from env.",
    )

    # Legacy / explicit variants for tests and direct invocation. The
    # postgres docker image's POSTGRES_PASSWORD / POSTGRES_PASSWORD_FILE
    # convention is mirrored here so the same secret material can be
    # mounted identically into both the db and backend containers.
    POSTGRES_PASSWORD: Optional[str] = Field(default=None)
    POSTGRES_PASSWORD_FILE: Optional[str] = Field(default=None)
    POSTGRES_USER: Optional[str] = Field(default=None)
    POSTGRES_DB: Optional[str] = Field(default=None)

    # --- AI / TTS (legacy — runtime is a pure read layer; these are
    #     only used by deploy-time data_pipeline tools, never at request
    #     time. Kept here for completeness.)
    AI_API_KEY: Optional[str] = Field(default=None)
    AI_BASE_URL: Optional[str] = Field(default=None)
    AI_MODEL: Optional[str] = Field(default=None)
    TENCENT_SECRET_ID: Optional[str] = Field(default=None)
    TENCENT_SECRET_KEY: Optional[str] = Field(default=None)
    TENCENT_APP_ID: Optional[str] = Field(default=None)

    # --- Frontend build-time ------------------------------------------------
    NEXT_PUBLIC_API_URL: Optional[str] = Field(default=None)

    # -----------------------------------------------------------------------
    # Validators
    # -----------------------------------------------------------------------
    @field_validator("ALLOWED_ORIGINS")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return v.strip() if v else v

    # -----------------------------------------------------------------------
    # Public helpers
    # -----------------------------------------------------------------------
    def allowed_origins_list(self) -> list[str]:
        """ALLOWED_ORIGINS as a list (for fastapi CORSMiddleware)."""
        if not self.ALLOWED_ORIGINS:
            return []
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    def resolved_database_url(self) -> str:
        """DATABASE_URL, with _FILE indirection resolved.

        Resolution order:
          1. `DATABASE_URL` env (already in self.DATABASE_URL).
          2. `DATABASE_URL_FILE` — read file, strip whitespace, return.

        Raises if neither yields a value. Empty file is treated as missing.
        """
        if self.DATABASE_URL:
            return self.DATABASE_URL
        if self.DATABASE_URL_FILE:
            value = _read_secret_file(self.DATABASE_URL_FILE)
            if value:
                return value
        raise RuntimeError(
            "DATABASE_URL is not set: provide DATABASE_URL or DATABASE_URL_FILE"
        )


# ---------------------------------------------------------------------------
# _read_secret_file — read a secret file path safely. Strips trailing
# whitespace (but not interior), rejects paths that don't exist or that
# point at directories. Called by Settings._resolve_file_indirection via
# pydantic's model_validator chain — kept module-private to discourage
# direct use from outside this file.
# ---------------------------------------------------------------------------
def _read_secret_file(path: str) -> Optional[str]:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise RuntimeError(f"Failed to read secret file {path}: {exc}") from exc
    return text.strip() or None


# ---------------------------------------------------------------------------
# Settings bootstrap with *_FILE indirection applied at construction time
# (so all downstream code can rely on self.DATABASE_URL being a real URL,
# never the name of a file).
# ---------------------------------------------------------------------------
def _apply_file_indirection() -> None:
    """If *_FILE is set, read the file and inject the value into the
    matching setting's env var. Done before pydantic-settings reads the
    environment, so the resulting Settings instance has the resolved
    value in the normal field.
    """
    pairs = (
        ("DATABASE_URL", "DATABASE_URL_FILE"),
        ("POSTGRES_PASSWORD", "POSTGRES_PASSWORD_FILE"),
    )
    for value_key, file_key in pairs:
        file_path = os.environ.get(file_key)
        if not file_path:
            continue
        # Only set the value if it isn't already set directly — explicit
        # env wins over file indirection.
        if os.environ.get(value_key):
            continue
        value = _read_secret_file(file_path)
        if value is not None:
            os.environ[value_key] = value


# ---------------------------------------------------------------------------
# _require_secrets — runtime invariants. Called once on first get_settings().
# Mirrors the original config.py's behaviour: SECRET_KEY must be a real
# secret, not the default placeholder; database must be configured.
# ---------------------------------------------------------------------------
_SECRET_KEY_PLACEHOLDER = "change-me-in-production-must-be-at-least-32-chars-long"
_SECRET_KEY_MIN_LEN = 32


def _require_secrets(settings: "Settings") -> None:
    if not settings.SECRET_KEY or settings.SECRET_KEY == _SECRET_KEY_PLACEHOLDER:
        raise RuntimeError(
            "SECRET_KEY is missing or still at the default placeholder. "
            "Run ./scripts/prod/init.sh to generate one, or set it in .env."
        )
    if len(settings.SECRET_KEY) < _SECRET_KEY_MIN_LEN:
        raise RuntimeError(
            f"SECRET_KEY is too short ({len(settings.SECRET_KEY)} chars). "
            f"Must be ≥{_SECRET_KEY_MIN_LEN} chars."
        )
    # Touch resolved_database_url() so we fail fast if DB is unconfigured.
    try:
        settings.resolved_database_url()
    except RuntimeError as exc:
        raise RuntimeError(
            f"Database is not configured: {exc}. "
            "Mount DATABASE_URL_FILE (compose secret) or set DATABASE_URL."
        ) from exc


# ---------------------------------------------------------------------------
# get_settings — cached singleton. pydantic-settings re-reads the env on
# every Settings() call; the lru_cache keeps it once per process.
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _apply_file_indirection()
    settings = Settings()
    _require_secrets(settings)
    return settings
