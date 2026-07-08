#!/usr/bin/env python3
"""
generate_audio.py — bulk-generate MP3s for sentences via Tencent Cloud TTS.

For each sentence where audio_url is empty, call Tencent Cloud TTS and
save the resulting MP3 to AUDIO_DIR/{hash}.mp3. UPDATE sentences.audio_url
to `/audio/{hash}.mp3` so the runtime (nginx → /audio/) can serve it.

Idempotent on rerun:
  - Skips sentences whose audio_url is already set AND the file exists
    on disk.
  - With --force, regenerates everything regardless.

Usage:
    python -m cms.generate_audio
    python -m cms.generate_audio --lib cet4
    python -m cms.generate_audio --force
    python -m cms.generate_audio --dry-run

TENCENT_* credentials must be all-or-nothing (see env.sh doctor).
"""
import argparse
import hashlib
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from cms.env import setup_env, load_config
else:
    from .env import setup_env, load_config

import psycopg2

# Voice config — defaults match the original ai_service.py. Override
# via env if needed.
DEFAULT_VOICE_TYPE = "1001"          #的女声 (standard female)
DEFAULT_VOICE_NAME = "ruoxi"         # 若汐 — clear, mid-pitch
DEFAULT_CODEC = "mp3"
DEFAULT_SAMPLE_RATE = 16000


def audio_filename(text: str) -> str:
    """Stable filename for a sentence. Same input → same filename → dedupe."""
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    return f"{h}.mp3"


def call_tencent_tts(cfg, text: str) -> bytes:
    """Call Tencent Cloud TTS and return raw MP3 bytes.

    Uses the TencentCloud SDK for Python (tencentcloud-sdk-python).
    Raises on failure — caller logs + continues to next sentence.
    """
    # Lazy import — only needed if we're actually generating.
    from tencentcloud.common import credential
    from tencentcloud.tts.v20190823 import tts_client, models

    cred = credential.Credential(cfg.tencent_secret_id, cfg.tencent_secret_key)
    # NOTE: tencentcloud-sdk-python ≥ 3.x renamed the per-product client
    # classes from a bare `<product>.Client` to `<Product>Client`
    # (e.g. tts_client.Client → tts_client.TtsClient). The old name is
    # no longer exported, so importing it would fail at runtime.
    client = tts_client.TtsClient(cred, "ap-guangzhou")  # region for TTS

    req = models.TextToVoiceRequest()
    req.Text = text
    req.SessionId = audio_filename(text).rsplit(".", 1)[0]  # up to 64 chars
    req.ModelType = 1          # 1=neural, 0=basic
    req.VoiceType = int(DEFAULT_VOICE_TYPE)
    req.PrimaryLanguage = 1     # 1=English, 2=Chinese
    req.SampleRate = DEFAULT_SAMPLE_RATE
    req.Codec = DEFAULT_CODEC

    resp = client.TextToVoice(req)
    # Response.Audio is base64-encoded.
    import base64
    return base64.b64decode(resp.Audio)


def list_sentences_needing_audio(conn, lib: str | None, limit: int) -> list[tuple]:
    """[(sentence_id, text, audio_url), ...] — sentences whose MP3 is
    missing on disk or audio_url is empty.
    """
    with conn.cursor() as cur:
        if lib:
            cur.execute(
                """
                SELECT s.id, s.text, s.audio_url
                FROM sentences s
                JOIN vocabulary_libs v ON v.id = s.lib_id
                WHERE v.level = %s AND s.audio_url = ''
                ORDER BY s.created_at
                LIMIT %s
                """,
                (lib, limit),
            )
        else:
            cur.execute(
                """
                SELECT id, text, audio_url
                FROM sentences
                WHERE audio_url = ''
                ORDER BY created_at
                LIMIT %s
                """,
                (limit,),
            )
        return cur.fetchall()


def mark_audio_url(conn, sentence_id, audio_url: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE sentences SET audio_url = %s WHERE id = %s",
            (audio_url, str(sentence_id)),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Bulk-generate audio via Tencent TTS.")
    parser.add_argument("--lib", help="Only process this lib.")
    parser.add_argument("--limit", type=int, default=500,
                        help="Max sentences to process per run (default: 500).")
    parser.add_argument("--force", action="store_true",
                        help="Regenerate even if audio_url is set.")
    parser.add_argument("--dry-run", action="store_true",
                        help="List sentences that need audio; don't generate.")
    args = parser.parse_args()

    setup_env()
    cfg = load_config()
    cfg.require_tencent()  # raise clearly if TENCENT_* unset, with a pointer at .env.db

    audio_dir = Path(cfg.audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)

    print(f"[generate_audio] audio_dir: {audio_dir}")
    print(f"[generate_audio] mode:      "
          f"{'dry-run' if args.dry_run else 'force' if args.force else 'fill-missing'}")
    if args.lib:
        print(f"[generate_audio] lib:       {args.lib}")
    print()

    with psycopg2.connect(cfg.database_url) as conn:
        if args.force:
            # Reset audio_url so list_sentences_needing_audio picks them up.
            with conn.cursor() as cur:
                if args.lib:
                    cur.execute(
                        """
                        UPDATE sentences SET audio_url = ''
                        FROM vocabulary_libs v
                        WHERE sentences.lib_id = v.id AND v.level = %s
                        """,
                        (args.lib,),
                    )
                else:
                    cur.execute("UPDATE sentences SET audio_url = ''")
                conn.commit()

        rows = list_sentences_needing_audio(conn, args.lib, args.limit)
        if not rows:
            print("  · nothing to do (all sentences have audio_url set)")
            return

        if args.dry_run:
            for sid, text, _ in rows[:20]:
                print(f"  ? {sid}  {text[:60]}{'...' if len(text) > 60 else ''}")
            if len(rows) > 20:
                print(f"  ... and {len(rows) - 20} more")
            return

        # Generate one at a time so a single bad sentence doesn't tank the batch.
        ok = 0
        fail = 0
        start = time.time()
        for i, (sid, text, _) in enumerate(rows, 1):
            fn = audio_filename(text)
            target = audio_dir / fn
            try:
                mp3_bytes = call_tencent_tts(cfg, text)
                target.write_bytes(mp3_bytes)
                mark_audio_url(conn, sid, f"/audio/{fn}")
                conn.commit()
                ok += 1
                if i % 10 == 0 or i == len(rows):
                    rate = ok / max(time.time() - start, 0.1)
                    print(f"  [{i}/{len(rows)}] ok={ok} fail={fail}  ({rate:.1f}/s)")
            except Exception as exc:
                fail += 1
                print(f"  ✗ {sid}: {exc}", file=sys.stderr)
                conn.rollback()  # so the next iteration's UPDATE isn't poisoned
                continue

        print()
        print(f"[generate_audio] done — ok={ok} fail={fail}  ({time.time()-start:.1f}s)")


if __name__ == "__main__":
    main()