"""
cms.storage — abstract storage layer for content assets (audio, images, etc.).

Why a storage abstraction:
  The CMS pipeline writes binary assets (currently just MP3s) to durable
  storage so the bake process can reference them across runs, hosts, and
  rebuild cycles. The previous design wrote to a local directory
  (cms/.local/audio) which broke on multi-host CMS setups — the
  same content was baked on different machines and the local files
  weren't shared.

  By abstracting put/get/exists behind a Storage interface, we can swap
  providers without touching callers (generate_audio.py, future
  image_uploader.py, etc.). The default LocalFsStorage preserves the
  old behavior for single-host CMS hosts; TencentCosStorage uploads
  to COS for multi-host or production CMS hosts.

Provider contract (all methods raise on transport error):
  put(key, data: bytes) -> None
      Upload `data` to `key` (slash-separated, e.g. "audio/abc123.mp3").
      Overwrites if `key` already exists. Provider-agnostic; idempotent.
  get(key) -> bytes
      Download `key`. Raises if not found.
  exists(key) -> bool
      True if `key` is present in the backing store.
  public_url(key) -> str
      Return the URL a browser / audio element can use to fetch `key`.
      For LocalFsStorage this is a `/audio/{filename}` path (frontend
      passes it through getAudioUrl which prepends the API base when
      relative). For TencentCosStorage this is the full COS URL
      (https://{bucket}.cos.{region}.myqcloud.com/{key}).

Usage from CMS code:
    from cms_pipeline.env import setup_env, load_config
    from cms_pipeline.storage import get_storage
    setup_env()
    cfg = load_config()
    storage = get_storage(cfg)
    storage.put("audio/abc.mp3", mp3_bytes)
    audio_url = storage.public_url("audio/abc.mp3")
    db.execute("UPDATE sentences SET audio_url = %s ...", (audio_url,))

Selecting a provider:
  CLOUD_PROVIDER env var (default "local_fs"). When set to "tencent_cos",
  CLOUD_BUCKET / CLOUD_REGION / CLOUD_ACCESS_KEY / CLOUD_SECRET_KEY must
  also be set — see env.py::require_cloud().

Why Tencent COS (not S3, not Aliyun OSS):
  The CMS pipeline already uses Tencent Cloud TTS — adding COS keeps
  the provider count to one. The Tencent SDK is `cos-python-sdk-v5`
  (PyPI: cos-python-sdk-v5); installed separately from tencentcloud-sdk
  because COS uses an XML/HTTP API rather than the Tencent Cloud SDK
  protocol.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .env import Config


# Where LocalFsStorage writes by default. The "audio/" subdir is
# preserved for forward-compat: future content types (images, video)
# would live as siblings under cms/.local/.
_LOCAL_DEFAULT_ROOT = "cms/.local"


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------
class Storage(ABC):
    """Provider-agnostic content storage interface."""

    @abstractmethod
    def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def public_url(self, key: str) -> str: ...


# ---------------------------------------------------------------------------
# LocalFsStorage — default, no external deps
# ---------------------------------------------------------------------------
class LocalFsStorage(Storage):
    """Write under a local directory. public_url returns the relative path
    that the backend's getAudioUrl() helper will resolve against the API
    base URL. Suitable for single-host CMS pipelines only.

    Pairs with cms/.gitignore rule `.local/` (the root is already
    gitignored; audio/ subdir is implicit).
    """

    def __init__(self, root: str = _LOCAL_DEFAULT_ROOT) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        # Normalise: strip leading slashes so callers can pass either
        # "audio/foo.mp3" or "/audio/foo.mp3" interchangeably.
        key = key.lstrip("/")
        return self.root / key

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        p = self._path(key)
        if not p.is_file():
            raise FileNotFoundError(f"storage key not found: {key}")
        return p.read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def public_url(self, key: str) -> str:
        # Relative path the backend's getAudioUrl() resolves to the API
        # base. Matches the old generate_audio.py behavior.
        return "/" + key.lstrip("/")


# ---------------------------------------------------------------------------
# TencentCosStorage — production multi-host setup
# ---------------------------------------------------------------------------
class TencentCosStorage(Storage):
    """Upload to Tencent Cloud COS.

    Lazy-imports cos-python-sdk-v5 to keep the LocalFsStorage default
    lightweight (CMS hosts not using COS don't pay the install cost).

    public_url returns the COS bucket URL with the key. Optionally
    configurable via CLOUD_ENDPOINT (for Tencent Cloud CDN custom
    domain — set this to your CDN domain once you wire one up).
    """

    def __init__(
        self,
        bucket: str,
        region: str,
        access_key: str,
        secret_key: str,
        endpoint: str | None = None,
    ) -> None:
        try:
            from qcloud_cos import CosConfig, CosS3Client  # cos-python-sdk-v5
        except ImportError as exc:
            raise RuntimeError(
                "CLOUD_PROVIDER=tencent_cos requires cos-python-sdk-v5 "
                "(pip install cos-python-sdk-v5)"
            ) from exc
        self.bucket = bucket
        # cos-python-sdk-v5's CosConfig.Endpoint is the host portion only
        # (no scheme). Passing `https://...` makes the SDK splice the
        # scheme back in and produce malformed hosts like
        # `{bucket}.https` (verified empirically — gives DNS failures on
        # every request). Default to letting the SDK derive the host from
        # Region + Scheme, and keep `self._endpoint` for public_url().
        cos_endpoint = endpoint or f"cos.{region}.myqcloud.com"
        config = CosConfig(
            Region=region,
            SecretId=access_key,
            SecretKey=secret_key,
            Scheme="https",
            Endpoint=cos_endpoint,
        )
        self._client = CosS3Client(config)
        # public_url() needs the full origin (with scheme).
        self._endpoint = "https://" + cos_endpoint.lstrip("/")

    def put(self, key: str, data: bytes) -> None:
        # Simple upload (<= 5MB covers every TTS-generated MP3 in practice;
        # for larger files swap in `upload_file` or chunked uploads).
        self._client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def get(self, key: str) -> bytes:
        resp = self._client.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].get_raw_stream().read()

    def exists(self, key: str) -> bool:
        # head_object returns 404 when missing; SDK raises. We use a
        # boolean query to keep callers simple.
        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:  # cos-python-sdk-v5 raises CosClientError on 404
            return False

    def public_url(self, key: str) -> str:
        # If endpoint is a CDN custom domain (no ".cos." in host), use it
        # as-is. Otherwise use the COS virtual-hosted style:
        # https://{bucket}.{region}.myqcloud.com/{key}. COS rejects
        # path-style access with "PathStyleDomainForbidden" (verified),
        # so we must always put the bucket in the subdomain, not the path.
        if "cos." not in self._endpoint:
            return f"{self._endpoint.rstrip('/')}/{key.lstrip('/')}"
        return f"https://{self.bucket}.{self._endpoint.split('://', 1)[-1].rstrip('/')}/{key.lstrip('/')}"


# ---------------------------------------------------------------------------
# Factory — single entry point used by callers
# ---------------------------------------------------------------------------
def get_storage(cfg: "Config") -> Storage:
    """Return the Storage instance selected by cfg.cloud_provider.

    For CLOUD_PROVIDER="local_fs" (default) → LocalFsStorage at
    cms/.local. The root can be overridden via AUDIO_DIR for
    backward-compat (the existing AUDIO_DIR env var continues to
    work — but its meaning narrows: it's now the *root* of the
    local storage, not just audio).

    For CLOUD_PROVIDER="tencent_cos" → TencentCosStorage, requires
    cfg.require_cloud() to have been called by the caller.
    """
    provider = (cfg.cloud_provider or "local_fs").lower()
    if provider == "local_fs":
        return LocalFsStorage(root=cfg.audio_dir or _LOCAL_DEFAULT_ROOT)
    if provider == "tencent_cos":
        cfg.require_cloud()
        return TencentCosStorage(
            bucket=cfg.cloud_bucket,
            region=cfg.cloud_region,
            access_key=cfg.cloud_access_key,
            secret_key=cfg.cloud_secret_key,
            endpoint=cfg.cloud_endpoint,
        )
    raise ValueError(
        f"Unknown CLOUD_PROVIDER={provider!r}. "
        f"Expected one of: local_fs, tencent_cos."
    )