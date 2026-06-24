#!/usr/bin/env python3
"""
generate_sentences.py — bulk-generate practice sentences via OpenAI.

For each (lib, difficulty) bucket, fills the sentences table up to
DEFAULT_BUCKET_TARGET_SIZE. Words are sampled randomly from
vocabulary_words. Each sentence targets 1-3 words from the sample so
that audio caching by sentence is meaningful.

Idempotent on rerun:
  - We only fill buckets below the target size.
  - Words already covered by an existing sentence (via target_words)
    are skipped on the next pass.

Usage:
    python -m pipeline.generate_sentences
    python -m pipeline.generate_sentences --lib cet4 --target-size 50
    python -m pipeline.generate_sentences --dry-run
"""
import argparse
import json
import random
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from pipeline.env import setup_env, load_config
else:
    from .env import setup_env, load_config

import psycopg2

# Default sentence buckets per (lib, difficulty). Difficulty affects
# sentence length / vocabulary complexity in the prompt. Keep small —
# content.sh can layer extra difficulties on top.
DIFFICULTIES = ["beginner", "intermediate", "advanced"]


def pick_uncovered_words(conn, lib_id: str, difficulty: str, n: int) -> list[str]:
    """Pick `n` random words from this lib that aren't yet in any sentence
    for this difficulty.

    Returns a list of word strings. May return < n if the lib is small.
    """
    with conn.cursor() as cur:
        # Words in this lib not used as a target_word in any sentence
        # for the given difficulty.
        cur.execute(
            """
            SELECT vw.word
            FROM vocabulary_words vw
            WHERE vw.lib_id = %s
              AND NOT EXISTS (
                SELECT 1 FROM sentences s
                WHERE s.lib_id = vw.lib_id
                  AND s.difficulty = %s
                  AND %s = ANY (s.target_words)
              )
            ORDER BY random()
            LIMIT %s
            """,
            (lib_id, difficulty, difficulty, n),
        )
        return [row[0] for row in cur.fetchall()]


def current_count(conn, lib_id: str, difficulty: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM sentences WHERE lib_id = %s AND difficulty = %s",
            (lib_id, difficulty),
        )
        return cur.fetchone()[0]


def build_prompt(words: list[str], difficulty: str) -> list[dict]:
    """Construct the OpenAI chat messages for a sentence batch.

    Output JSON shape (we parse strictly):
        {"sentences": [{"text": "...", "chinese_text": "...", "target_words": [...]}]}
    """
    word_list = ", ".join(words)
    system = (
        "You are an English-teaching assistant. Generate practice sentences "
        "for English learners. Each sentence MUST use at least one of the "
        "target words. Match the requested difficulty level. Output JSON only."
    )
    user = (
        f"Target words ({len(words)}): {word_list}\n"
        f"Difficulty: {difficulty}\n\n"
        f"Generate {len(words)} distinct sentences. Each sentence:\n"
        "  - Uses 1-3 of the target words (case-insensitive, exact match).\n"
        "  - Is natural, grammatical English.\n"
        f"  - Difficulty: {difficulty} (beginner=short+common; advanced=longer+idiomatic).\n"
        "  - Length: 8-20 words.\n"
        "  - Is unique across the batch.\n\n"
        'Return JSON: {"sentences": ['
        '{"text": "<en>", "chinese_text": "<zh translation>", '
        '"target_words": ["<matched words from target list>"]}, ...]}'
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def call_openai(cfg, words: list[str], difficulty: str) -> list[dict]:
    """Call OpenAI and parse the JSON response. Raises on parse / API errors."""
    from openai import OpenAI

    client = OpenAI(api_key=cfg.ai_api_key, base_url=cfg.ai_base_url)
    messages = build_prompt(words, difficulty)
    response = client.chat.completions.create(
        model=cfg.ai_model,
        messages=messages,
        temperature=0.7,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    parsed = json.loads(content)
    sentences = parsed.get("sentences", [])
    if not isinstance(sentences, list):
        raise ValueError("OpenAI response missing 'sentences' list")
    return sentences


def insert_sentences(conn, lib_id: str, difficulty: str, items: list[dict]) -> int:
    """INSERT a batch of sentences. Returns the count actually inserted.

    Skips items where text is empty or already exists for this lib+difficulty.
    """
    inserted = 0
    target_word_set_cache: dict[str, set[str]] = {}

    def lc(target_list):
        key = tuple(target_list)
        if key not in target_word_set_cache:
            target_word_set_cache[key] = {w.lower() for w in target_list}
        return target_word_set_cache[key]

    rows = []
    for item in items:
        text = (item.get("text") or "").strip()
        if not text:
            continue
        chinese = (item.get("chinese_text") or "").strip()
        target_words = item.get("target_words") or []
        if not target_words:
            continue
        # Lowercase + dedup target_words so we don't store e.g. ["Apple","apple"].
        seen: set[str] = set()
        normalised: list[str] = []
        for w in target_words:
            lw = w.lower()
            if lw not in seen:
                seen.add(lw)
                normalised.append(lw)
        rows.append((
            str(uuid.uuid4()),
            lib_id,
            text,
            chinese,
            normalised,
            difficulty,
            "",  # audio_url — filled by generate_audio.py
            True,  # is_cached — for runtime cache stats (always True for baked)
            0,  # use_count
            datetime.now(timezone.utc),
            datetime.now(timezone.utc),
        ))

    if not rows:
        return 0

    with conn.cursor() as cur:
        # ON CONFLICT DO NOTHING via a uniqueness check. We use (lib_id, text,
        # difficulty) as the natural key — duplicate insertions are silently
        # dropped, which is fine for re-runs.
        cur.executemany(
            """
            INSERT INTO sentences
                (id, lib_id, text, chinese_text, target_words, difficulty,
                 audio_url, is_cached, use_count, created_at, last_used_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            rows,
        )
        inserted = cur.rowcount
    return inserted


def fill_bucket(conn, cfg, lib_id: str, lib_name: str, difficulty: str,
                target_size: int, dry_run: bool) -> dict:
    """Top up a (lib, difficulty) bucket to target_size sentences."""
    current = current_count(conn, lib_id, difficulty)
    deficit = target_size - current
    if deficit <= 0:
        return {"lib": lib_name, "difficulty": difficulty, "needed": 0, "inserted": 0}

    # We pick min(deficit, len(lib)) words per OpenAI call to keep
    # prompt sizes reasonable. Batches of 5 words = 5 sentences.
    BATCH = 5
    inserted_total = 0
    if dry_run:
        return {"lib": lib_name, "difficulty": difficulty, "needed": deficit, "inserted": "(dry-run)"}

    # Use multiple batches until deficit is covered (or words run out).
    while deficit > 0:
        words = pick_uncovered_words(conn, lib_id, difficulty, BATCH)
        if len(words) < 1:
            break
        try:
            items = call_openai(cfg, words, difficulty)
        except Exception as exc:
            print(f"  ✗ OpenAI call failed: {exc}", file=sys.stderr)
            break
        n = insert_sentences(conn, lib_id, difficulty, items)
        inserted_total += n
        deficit -= n
        # If we couldn't insert any (all duplicates), break to avoid infinite loop.
        if n == 0:
            break

    conn.commit()
    return {
        "lib": lib_name,
        "difficulty": difficulty,
        "needed": target_size - current,
        "inserted": inserted_total,
    }


def list_libs(conn) -> list[tuple]:
    """Return [(id, level, display_name), ...]."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, level, name FROM vocabulary_libs ORDER BY level")
        return cur.fetchall()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bulk-generate sentences via OpenAI.")
    parser.add_argument("--lib", help="Only process this lib (level name).")
    parser.add_argument("--difficulty", choices=DIFFICULTIES,
                        help="Only process this difficulty.")
    parser.add_argument("--target-size", type=int,
                        help="Override DEFAULT_BUCKET_TARGET_SIZE for this run.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print plan without calling OpenAI or writing.")
    args = parser.parse_args()

    setup_env()
    cfg = load_config()
    cfg.require_ai()  # raise clearly if AI_* unset, with a pointer at .env.db

    target = args.target_size or cfg.default_bucket_target_size
    diffs = [args.difficulty] if args.difficulty else DIFFICULTIES

    print(f"[generate_sentences] target_size per (lib, difficulty): {target}")
    print(f"[generate_sentences] difficulties: {', '.join(diffs)}")
    print(f"[generate_sentences] mode: {'dry-run' if args.dry_run else 'fill'}")
    print()

    with psycopg2.connect(cfg.database_url) as conn:
        libs = list_libs(conn)
        if args.lib:
            libs = [l for l in libs if l[1] == args.lib]
            if not libs:
                sys.exit(f"lib '{args.lib}' not found — run import_vocab first?")

        results = []
        for lib_id, level, name in libs:
            for d in diffs:
                results.append(fill_bucket(conn, cfg, lib_id, name, d, target, args.dry_run))

    # Summary
    for r in results:
        marker = "✓" if (isinstance(r["inserted"], int) and r["inserted"] > 0) else "·"
        print(f"  {marker} {r['lib']:14s} {r['difficulty']:13s} needed={r['needed']:>4}  inserted={r['inserted']}")


if __name__ == "__main__":
    main()