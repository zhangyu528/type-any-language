"""
Backend runtime configuration.

The runtime is a pure read-layer:
  - No AI, no TTS, no scheduler.
  - Content (vocab libs/words/sentences) lives in the db (postgres
    container in dev / on the CVM host in prod).
  - The backend just opens a SQLAlchemy session and serves GET endpoints.

Secrets come via environment:
  - DATABASE_URL is set by docker-compose's `environment:` block
    (the canonical path).
  - DATABASE_URL_FILE (legacy indirection) is still honored as a
    fallback — self-hosted deployments can mount a secrets file and
    point at it. New deployments should just set DATABASE_URL directly.
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

    # --- App ----------------------------------------------------------------
    ALLOWED_ORIGINS: str = Field(
        default="http://localhost,http://localhost:3000",
        description=(
            "Comma-separated CORS allow-list. Override via the ALLOWED_ORIGINS "
            "env var (set by docker-compose from the shell); this default is "
            "the last-resort fallback when no override is provided."
        ),
    )

    # --- Database -----------------------------------------------------------
    # Canonical path: DATABASE_URL set by docker-compose environment.
    # Legacy fallback: DATABASE_URL_FILE — read the file, use its contents.
    # _apply_file_indirection() (below) runs before pydantic reads env, so
    # resolved_database_url() always sees a real URL.
    DATABASE_URL: Optional[str] = Field(
        default=None,
        description="postgresql:// connection URL. If unset, DATABASE_URL_FILE is consulted.",
    )
    DATABASE_URL_FILE: Optional[str] = Field(
        default=None,
        description=(
            "Path to a file containing DATABASE_URL (legacy indirection). "
            "Read once, then discarded from env. New deployments should "
            "just set DATABASE_URL directly via docker-compose env."
        ),
    )

    # -----------------------------------------------------------------------
    @field_validator("ALLOWED_ORIGINS")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return v.strip() if v else v

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
# point at directories.
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
# _apply_file_indirection — if DATABASE_URL_FILE is set, read the file
# and inject DATABASE_URL into the process env before pydantic-settings
# reads it. Done once on first get_settings() (with lru_cache below).
# ---------------------------------------------------------------------------
def _apply_file_indirection() -> None:
    file_path = os.environ.get("DATABASE_URL_FILE")
    if not file_path:
        return
    # Explicit DATABASE_URL wins over file indirection.
    if os.environ.get("DATABASE_URL"):
        return
    value = _read_secret_file(file_path)
    if value is not None:
        os.environ["DATABASE_URL"] = value


# ---------------------------------------------------------------------------
# _require_secrets — runtime invariants. Called once on first get_settings().
# ---------------------------------------------------------------------------
def _require_secrets(settings: "Settings") -> None:
    try:
        settings.resolved_database_url()
    except RuntimeError as exc:
        raise RuntimeError(
            f"Database is not configured: {exc}. "
            "Set DATABASE_URL in docker-compose env or self-host env."
        ) from exc


# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _apply_file_indirection()
    settings = Settings()
    _require_secrets(settings)
    return settings
