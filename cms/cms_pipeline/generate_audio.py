#!/usr/bin/env python3
"""
generate_audio.py — bulk-fill audio_url in the sentences JSONL files.

For each sentence in cms/.local/staging/sentences/<lib>.jsonl where
audio_url is empty, call Tencent Cloud TTS, upload the MP3 to
storage (LocalFsStorage or TencentCosStorage — see cms.storage),
and update the sentence in the JSONL with the public URL.

Pure file producer:
  - Reads sentences from JSONL files
  - Writes back to the same JSONL
  - Does NOT touch the db (db side imports via dbtools.importer)

The import order is: import_vocab → generate_sentences → generate_audio
→ import_staging. The importer reads each sentence's audio_url field
and UPSERTs into the sentences table. So this module's job is to
ensure the audio_url is filled in before the importer runs.

Idempotent on rerun:
  - Skips sentences whose audio_url is already set AND the storage
    key already has the file (Storage.exists()).
  - With --force, regenerates even if audio_url is set.

Why TTS via Storage abstraction:
  - LocalFsStorage: writes to cms/.local/audio/{hash}.mp3
  - TencentCosStorage: uploads to COS bucket
  - In both cases, the public URL is stored in the sentence's
    audio_url field (which the db side later imports).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
    from cms_pipeline.storage import get_storage, LocalFsStorage
else:
    from .storage import get_storage, LocalFsStorage


DEFAULT_VOICE_TYPE = "1001"          # standard female
DEFAULT_VOICE_NAME = "ruoxi"         # 若汐
DEFAULT_CODEC = "mp3"
DEFAULT_SAMPLE_RATE = 16000


def find_project_root() -> Path:
    """Project root = 4 hops up from cms/cms_pipeline/generate_audio.py."""
    return Path(__file__).resolve().parent.parent.parent.parent


def find_staging_dir() -> Path:
    env = os.environ.get("CMS_STAGING_DIR", "").strip()
    return Path(env) if env else find_project_root() / "cms" / ".local" / "staging"


# --- TTS bits ---

def audio_filename(text: str) -> str:
    """Stable filename for a sentence. Same input → same filename → dedupe."""
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    return f"{h}.mp3"


def call_tencent_tts(tencent_cfg, text: str) -> bytes:
    """Call Tencent Cloud TTS and return raw MP3 bytes.

    Raises on failure — caller logs + continues to next sentence.
    """
    from tencentcloud.common import credential
    from tencentcloud.tts.v20190823 import tts_client, models

    cred = credential.Credential(tencent_cfg["secret_id"], tencent_cfg["secret_key"])
    client = tts_client.TtsClient(cred, "ap-guangzhou")  # region for TTS

    req = models.TextToVoiceRequest()
    req.Text = text
    req.SessionId = audio_filename(text).rsplit(".", 1)[0]  # up to 64 chars
    req.ModelType = 1
    req.VoiceType = int(DEFAULT_VOICE_TYPE)
    req.PrimaryLanguage = 1     # 1=English
    req.SampleRate = DEFAULT_SAMPLE_RATE
    req.Codec = DEFAULT_CODEC

    resp = client.TextToVoice(req)
    return base64.b64decode(resp.Audio)


# --- Staging file I/O ---

def read_sentences_jsonl(path: Path) -> list[dict]:
    """Read sentences/<lib>.jsonl. Returns [] if file doesn't exist."""
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        out.append(json.loads(line))
    return out


def write_sentences_jsonl_atomic(path: Path, items: list[dict]) -> None:
    """Write all items back to the JSONL atomically (tmp + rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    tmp.replace(path)


def read_cms_env() -> dict:
    """Parse cms/.env directly. No cms_pipeline.env / Config dependency."""
    env_path = find_project_root() / "cms" / ".env"
    if not env_path.is_file():
        sys.exit(f"cms/.env not found at {env_path} — run ./cms/scripts/env.sh init")
    env: dict[str, str] = {}
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
            v = v[1:-1]
        env.setdefault(k.strip(), v)
    return env


# --- Main pipeline ---

def fill_one_lib(staging: Path, lib: str, storage, tencent_cfg,
                 force: bool, dry_run: bool) -> dict:
    """Fill audio_url for all sentences in <lib>.jsonl that need it.

    Returns a stats dict: {lib, total, generated, skipped, failed}.
    """
    sentences_path = staging / "sentences" / f"{lib}.jsonl"
    if not sentences_path.is_file():
        return {"lib": lib, "status": "no-sentences-file", "total": 0}

    sentences = read_sentences_jsonl(sentences_path)
    targets = [s for s in sentences if force or not s.get("audio_url")]
    if not targets:
        return {
            "lib": lib, "status": "all-done",
            "total": len(sentences), "filled": len(sentences),
            "generated": 0, "skipped": 0, "failed": 0,
        }

    if dry_run:
        return {
            "lib": lib, "status": "plan",
            "total": len(sentences), "to_fill": len(targets),
        }

    # Walk in order; update sentence dicts in-place
    n_gen = 0
    n_skip = 0
    n_fail = 0
    by_text = {s["text"]: i for i, s in enumerate(sentences)}

    start = time.time()
    for i, sentence in enumerate(targets, 1):
        text = sentence.get("text") or ""
        if not text:
            n_fail += 1
            continue
        key = f"audio/{audio_filename(text)}"
        try:
            if storage.exists(key) and not force:
                # Reuse existing audio, but re-stamp the public_url
                # (in case storage provider changed).
                public = storage.public_url(key)
                idx = by_text[text]
                sentences[idx]["audio_url"] = public
                n_skip += 1
                if i % 10 == 0 or i == len(targets):
                    print(f"    [{i}/{len(targets)}] gen={n_gen} skip={n_skip} fail={n_fail}")
                continue
            mp3_bytes = call_tencent_tts(tencent_cfg, text)
            storage.put(key, mp3_bytes)
            public = storage.public_url(key)
            idx = by_text[text]
            sentences[idx]["audio_url"] = public
            n_gen += 1
            if i % 10 == 0 or i == len(targets):
                rate = n_gen / max(time.time() - start, 0.1)
                print(f"    [{i}/{len(targets)}] gen={n_gen} skip={n_skip} fail={n_fail}  ({rate:.1f}/s)")
        except Exception as exc:
            n_fail += 1
            print(f"    ✗ {text[:60]!r}: {exc}", file=sys.stderr)
            continue

    write_sentences_jsonl_atomic(sentences_path, sentences)
    return {
        "lib": lib, "status": "written",
        "total": len(sentences), "generated": n_gen,
        "skipped": n_skip, "failed": n_fail,
    }


def list_libs_with_sentences(staging: Path) -> list[str]:
    """Return lib names (levels) that have a sentences/<level>.jsonl file."""
    sent_dir = staging / "sentences"
    if not sent_dir.is_dir():
        return []
    return sorted(
        p.stem for p in sent_dir.glob("*.jsonl")
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bulk-fill audio_url in sentences JSONL files (no db write).",
    )
    parser.add_argument(
        "--lib", help="Only process this lib (manifest id / level name).")
    parser.add_argument(
        "--limit", type=int, default=500,
        help="Max sentences to process per run (default: 500).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Regenerate even if audio_url is set.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="List which libs/sentences need audio; don't generate.",
    )
    args = parser.parse_args()

    staging = find_staging_dir()
    env = read_cms_env()

    # Tencent TTS keys — all-or-nothing
    tencent_keys = ("TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENT_APP_ID")
    if not args.dry_run and not all(env.get(k) for k in tencent_keys):
        missing = [k for k in tencent_keys if not env.get(k)]
        sys.exit(
            f"cms/.env missing TTS keys: {', '.join(missing)} — "
            f"run ./cms/scripts/env.sh update KEY=VALUE"
        )
    tencent_cfg = {
        "secret_id": env.get("TENCENT_SECRET_ID"),
        "secret_key": env.get("TENCENT_SECRET_KEY"),
        "app_id": env.get("TENCENT_APP_ID"),
    }

    # Build storage — same pattern as cms.storage.get_storage() but
    # without importing the full Config object.
    cloud_provider = env.get("CLOUD_PROVIDER", "local_fs").strip() or "local_fs"
    if cloud_provider == "local_fs":
        from cms_pipeline.storage import LocalFsStorage, _LOCAL_DEFAULT_ROOT
        audio_dir = env.get("AUDIO_DIR") or str(
            find_project_root() / _LOCAL_DEFAULT_ROOT
        )
        storage = LocalFsStorage(audio_dir)
    elif cloud_provider == "tencent_cos":
        from cms_pipeline.storage import TencentCosStorage
        storage = TencentCosStorage(
            bucket=env.get("CLOUD_BUCKET", ""),
            region=env.get("CLOUD_REGION", ""),
            access_key=env.get("CLOUD_ACCESS_KEY", ""),
            secret_key=env.get("CLOUD_SECRET_KEY", ""),
            endpoint=env.get("CLOUD_ENDPOINT"),
        )
    else:
        sys.exit(f"unsupported CLOUD_PROVIDER: {cloud_provider!r}")

    if args.lib:
        targets = [args.lib]
    else:
        targets = list_libs_with_sentences(staging)
    if not targets:
        print("[generate_audio] no sentences files in staging/sentences/")
        return 0

    print(f"[generate_audio] staging:    {staging}")
    print(f"[generate_audio] storage:    {type(storage).__name__}")
    if isinstance(storage, LocalFsStorage):
        print(f"[generate_audio] audio_dir:  {storage.root}")
    print(f"[generate_audio] mode:       "
          f"{'dry-run' if args.dry_run else 'force' if args.force else 'fill-missing'}")
    print(f"[generate_audio] libs:       {', '.join(targets)}")
    print()

    results = []
    for lib in targets:
        results.append(fill_one_lib(staging, lib, storage, tencent_cfg,
                                   args.force, args.dry_run))

    for r in results:
        st = r["status"]
        if st == "no-sentences-file":
            print(f"  -- {r['lib']:14s} no sentences file")
        elif st == "all-done":
            print(f"  ok {r['lib']:14s} all-done ({r['total']} filled, 0 to do)")
        elif st == "plan":
            print(f"  -- {r['lib']:14s} plan: {r['to_fill']} of {r['total']} need audio")
        elif st == "written":
            print(f"  ok {r['lib']:14s} written  gen={r['generated']} skip={r['skipped']} fail={r['failed']}")
        else:
            print(f"  ?? {r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())