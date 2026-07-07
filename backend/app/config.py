"""
Backend runtime configuration.

The runtime is a pure read-layer:
  - No AI, no TTS, no scheduler.
  - Content (vocab libs/words/sentences) lives in the db image.
  - The backend just opens a SQLAlchemy session and serves GET endpoints.

Secrets come via file indirection (POSTGRES_PASSWORD_FILE / DATABASE_URL_FILE)
so they never appear in `docker inspect container` output. Mirrors the
postgres image's own POSTGRES_PASSWORD_FILE convention.
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
    # DATABASE_URL or DATABASE_URL_FILE (preferred for secret delivery).
    # _apply_file_indirection() resolves the _FILE variant before pydantic
    # reads the env, so resolved_database_url() always sees a real URL.
    DATABASE_URL: Optional[str] = Field(
        default=None,
        description="postgresql:// connection URL. If unset, DATABASE_URL_FILE is consulted.",
    )
    DATABASE_URL_FILE: Optional[str] = Field(
        default=None,
        description="Path to a file containing DATABASE_URL. Read once, then discarded from env.",
    )

    # --- Auth (v1) ---------------------------------------------------------
    # JWT_SECRET or JWT_SECRET_FILE (preferred). The JWT signing secret
    # is delivered via file mount (compose secrets:) so it never appears
    # in `docker inspect container` output. Mirrors the DATABASE_URL
    # indirection pattern.
    JWT_SECRET: Optional[str] = Field(
        default=None,
        description="HMAC secret for signing JWTs. If unset, JWT_SECRET_FILE is consulted.",
    )
    JWT_SECRET_FILE: Optional[str] = Field(
        default=None,
        description="Path to a file containing JWT_SECRET. Read once, then discarded from env.",
    )
    JWT_ALGORITHM: str = Field(
        default="HS256",
        description="JWT signing algorithm. HS256 is the canonical choice for self-contained services.",
    )
    JWT_EXPIRES_DAYS: int = Field(
        default=7,
        description="JWT lifetime in days. Mirrored as the session cookie's max_age.",
    )
    # Cookie hardening — `Secure` flag must be off in dev (HTTP localhost)
    # and on in prod (HTTPS). Set via compose env in prod.
    COOKIE_SECURE: bool = Field(
        default=False,
        description="Set Secure flag on the session cookie. MUST be True in prod (HTTPS).",
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

    def resolved_jwt_secret(self) -> str:
        """JWT_SECRET, with _FILE indirection resolved. Same semantics as
        `resolved_database_url()` — explicit env wins over file."""
        if self.JWT_SECRET:
            return self.JWT_SECRET
        if self.JWT_SECRET_FILE:
            value = _read_secret_file(self.JWT_SECRET_FILE)
            if value:
                return value
        raise RuntimeError(
            "JWT_SECRET is not set: provide JWT_SECRET or JWT_SECRET_FILE"
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
    file_path = os.environ.get("DATABASE_URL_FILE")
    if file_path:
        # Explicit DATABASE_URL wins over file indirection.
        if not os.environ.get("DATABASE_URL"):
            value = _read_secret_file(file_path)
            if value is not None:
                os.environ["DATABASE_URL"] = value

    # JWT secret — same pattern.
    jwt_file_path = os.environ.get("JWT_SECRET_FILE")
    if jwt_file_path:
        if not os.environ.get("JWT_SECRET"):
            value = _read_secret_file(jwt_file_path)
            if value is not None:
                os.environ["JWT_SECRET"] = value


# ---------------------------------------------------------------------------
# _require_secrets — runtime invariants. Called once on first get_settings().
# ---------------------------------------------------------------------------
def _require_secrets(settings: "Settings") -> None:
    # Touch resolved_database_url() so we fail fast if DB is unconfigured.
    try:
        settings.resolved_database_url()
    except RuntimeError as exc:
        raise RuntimeError(
            f"Database is not configured: {exc}. "
            "Mount DATABASE_URL_FILE (compose secret) or set DATABASE_URL."
        ) from exc
    # Same fail-fast for JWT_SECRET — backend refuses to boot without it.
    try:
        settings.resolved_jwt_secret()
    except RuntimeError as exc:
        raise RuntimeError(
            f"JWT_SECRET is not configured: {exc}. "
            "Mount JWT_SECRET_FILE (compose secret) or set JWT_SECRET."
        ) from exc


# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _apply_file_indirection()
    settings = Settings()
    _require_secrets(settings)
    return settings