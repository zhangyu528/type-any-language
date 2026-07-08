#!/usr/bin/env python3
"""
generate_sentences.py — bulk-generate practice sentences via OpenAI.

For each (lib, difficulty) bucket, fills the sentences table up to the
target size (from manifest.yaml's `defaults.bucket_target_size`).
Words are sampled randomly from vocabulary_words. Each sentence targets
1-3 words from the sample so that audio caching by sentence is meaningful.

Difficulty lists are sourced from content/source/manifest.yaml (per-lib). The
OpenAI prompt itself is sourced from content/source/prompts/sentences.yaml.
Both are operator-editable — adding a new difficulty or tweaking the
prompt is a yaml edit, no Python change.

Idempotent on rerun:
  - We only fill buckets below the target size.
  - Words already covered by an existing sentence (via target_words)
    are skipped on the next pass.

Usage:
    python -m cms.generate_sentences
    python -m cms.generate_sentences --lib cet4 --difficulty beginner
    python -m cms.generate_sentences --target-size 50
    python -m cms.generate_sentences --dry-run
"""
import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
    from cms.env import setup_env, load_config
    from cms.manifest import load_manifest
else:
    from .env import setup_env, load_config
    from .manifest import load_manifest

import psycopg2
import yaml


# ---------------------------------------------------------------------------
# Prompt template loader + renderer
# ---------------------------------------------------------------------------
# The prompt lives at content/source/prompts/sentences.yaml — operators tweak it
# without editing Python. Variables are `{{name}}` style; we do a single
# regex pass, no Jinja, no extra deps.

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_PROMPT_PATH = _PROJECT_ROOT / "content" / "source" / "prompts" / "sentences.yaml"

# Pattern matches {{ var_name }} where var_name is [a-zA-Z_][a-zA-Z0-9_]*.
# Whitespace inside braces is allowed (it's a readability thing).
_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def _load_prompt(path: Path | None = None) -> dict:
    """Load the sentences prompt yaml. Returns dict with `system` / `user` / etc."""
    p = path or _PROMPT_PATH
    if not p.is_file():
        sys.exit(
            f"prompt template not found at {p}\n"
            f"  Expected: content/source/prompts/sentences.yaml at the project root."
        )
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        sys.exit(f"prompt yaml root must be a mapping, got {type(raw).__name__} ({p})")
    if "system" not in raw or "user" not in raw:
        sys.exit(f"prompt yaml must contain 'system' and 'user' keys ({p})")
    return raw


def _render(template: str, vars: dict) -> str:
    """Replace {{var}} placeholders with values from `vars`. Unresolved vars
    raise so a typo in the template fails loudly (instead of silently sending
    "{{difficulty}}" to the LLM).
    """
    def replace(m: re.Match) -> str:
        key = m.group(1)
        if key not in vars:
            raise KeyError(f"prompt template references undefined variable {key!r}")
        return str(vars[key])
    return _VAR_PATTERN.sub(replace, template)


def build_prompt(words: list[str], difficulty: str, lib_name: str,
                 prompt: dict | None = None) -> list[dict]:
    """Construct the OpenAI chat messages for a sentence batch.

    Variables available to the template:
        lib_name   - manifest.libs[i].display  (e.g. "CET-4")
        lib_id     - manifest.libs[i].id       (e.g. "cet4")
        difficulty - difficulty bucket         (e.g. "intermediate")
        word_list  - comma-joined target words
        count      - len(words)
    """
    if prompt is None:
        prompt = _load_prompt()
    word_list = ", ".join(words)
    vars = {
        "lib_name": lib_name,
        "difficulty": difficulty,
        "word_list": word_list,
        "count": str(len(words)),
    }
    return [
        {"role": "system", "content": _render(prompt["system"], vars).strip()},
        {"role": "user", "content": _render(prompt["user"], vars).strip()},
    ]


def call_openai(cfg, words: list[str], difficulty: str, lib_name: str,
                prompt: dict | None = None) -> list[dict]:
    """Call OpenAI and parse the JSON response. Raises on parse / API errors."""
    from openai import OpenAI

    client = OpenAI(api_key=cfg.ai_api_key, base_url=cfg.ai_base_url)
    messages = build_prompt(words, difficulty, lib_name, prompt)
    response = client.chat.completions.create(
        model=cfg.ai_model,
        messages=messages,
        temperature=0.7,
        # NOTE: response_format={"type": "json_object"} intentionally omitted.
        # That's an OpenAI-specific extension; the OpenAI-compatible endpoint
        # may not honour it. The model is also asked to output pure JSON in
        # build_prompt(); relying on that instead.
    )
    content = response.choices[0].message.content or "{}"
    # Two non-JSON artefacts some model series emit into message.content that
    # would break json.loads below:
    #   1. <think>...</think>  reasoning blocks
    #   2. Markdown code fences (```json ... ```) wrapping the JSON
    # Strip both before parsing.
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
    content = re.sub(r"^\s*```(?:json|JSON)?\s*", "", content)
    content = re.sub(r"\s*```\s*$", "", content)
    content = content.strip()
    parsed = json.loads(content)
    sentences = parsed.get("sentences", [])
    if not isinstance(sentences, list):
        raise ValueError("OpenAI response missing 'sentences' list")
    return sentences


def _parse_tags(raw) -> list[str] | None:
    """LLM may return tags as either a JSON list[str] or a semicolon-joined
    string. Returns a cleaned list (lowercased, deduped, non-empty), or
    None if no usable tags came in. Stored as TEXT[] in the DB.
    """
    if raw is None:
        return None
    if isinstance(raw, list):
        parts = [str(t).strip() for t in raw]
    elif isinstance(raw, str):
        parts = [t.strip() for t in raw.split(";")]
    else:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for t in parts:
        if not t:
            continue
        t_lc = t.lower()
        if t_lc in seen:
            continue
        seen.add(t_lc)
        out.append(t_lc)
    return out or None


def insert_sentences(conn, lib_id: str, difficulty: str, items: list[dict]) -> int:
    """INSERT a batch of sentences + their sentence_word_links. Returns inserted count.

    Skips items where text is empty or target_words is empty. Duplicate
    (lib_id, text, difficulty) tuples are silently dropped via ON CONFLICT
    DO NOTHING.

    Phase 2 changes:
      - Drops `is_cached` (column removed by migration 0005).
      - Adds `topic`, `register`, `cefr`, `tags` from the LLM response.
      - After sentences land, populates `sentence_word_links(sentence_id,
        word_id)` by resolving `vocabulary_words.id` from each target_word.
        Links for already-existing sentences are also re-inserted (the
        composite PK + ON CONFLICT DO NOTHING makes it a no-op).
    """
    rows = []
    # text -> normalised target_words; used to build sentence_word_links
    # after the INSERT.
    target_word_by_text: dict[str, list[str]] = {}

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
            "",  # audio_url -- filled by generate_audio.py
            (item.get("topic") or "").strip() or None,
            (item.get("register") or "").strip() or None,
            (item.get("cefr") or "").strip() or None,
            _parse_tags(item.get("tags")),
            0,  # use_count
            datetime.now(timezone.utc),
            datetime.now(timezone.utc),
        ))
        target_word_by_text[text] = normalised

    if not rows:
        return 0

    with conn.cursor() as cur:
        # ON CONFLICT DO NOTHING via (lib_id, text, difficulty) natural key --
        # duplicate insertions on rerun are silently dropped, which is fine.
        cur.executemany(
            """
            INSERT INTO sentences
                (id, lib_id, text, chinese_text, target_words, difficulty,
                 audio_url, topic, register, cefr, tags, use_count,
                 created_at, last_used_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            rows,
        )
        inserted = cur.rowcount

        # ------------------------------------------------------------------
        # sentence_word_links: authoritative FK join between sentences and
        # vocabulary_words. Built after the INSERT by:
        #   1. SELECT sentence ids for the texts we just attempted
        #   2. SELECT word ids for the target_words we just attempted
        #   3. INSERT (sentence_id, word_id) pairs ON CONFLICT DO NOTHING
        # Already-existing sentences get their links re-inserted too, but
        # the composite PK (sentence_id, word_id) makes ON CONFLICT a no-op.
        # ------------------------------------------------------------------
        if target_word_by_text:
            texts = list(target_word_by_text.keys())
            all_words: set[str] = set()
            for tw in target_word_by_text.values():
                all_words.update(tw)

            cur.execute(
                """
                SELECT id, text FROM sentences
                WHERE lib_id = %s AND difficulty = %s AND text = ANY(%s)
                """,
                (lib_id, difficulty, texts),
            )
            text_to_sid: dict[str, str] = {t: str(sid) for sid, t in cur.fetchall()}

            if all_words:
                cur.execute(
                    """
                    SELECT id, word FROM vocabulary_words
                    WHERE lib_id = %s AND word = ANY(%s)
                    """,
                    (lib_id, list(all_words)),
                )
                word_to_wid: dict[str, str] = {w: str(wid) for wid, w in cur.fetchall()}

            link_rows: list[tuple[str, str]] = []
            for text, twords in target_word_by_text.items():
                sid = text_to_sid.get(text)
                if not sid:
                    continue
                for w in twords:
                    wid = word_to_wid.get(w)
                    if wid:
                        link_rows.append((sid, wid))

            if link_rows:
                cur.executemany(
                    """
                    INSERT INTO sentence_word_links (sentence_id, word_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    link_rows,
                )

    return inserted


def fill_bucket(conn, cfg, lib_id: str, lib_name: str, difficulty: str,
                target_size: int, dry_run: bool, prompt: dict) -> dict:
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
            items = call_openai(cfg, words, difficulty, lib_name, prompt)
        except Exception as exc:
            print(f"  x OpenAI call failed: {exc}", file=sys.stderr)
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


def list_libs(conn) -> list[tuple]:
    """Return [(id, level, display_name), ...]."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, level, name FROM vocabulary_libs ORDER BY level")
        return cur.fetchall()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bulk-generate sentences via OpenAI.")
    manifest = load_manifest()
    all_lib_ids = manifest.all_lib_ids()
    all_diffs = manifest.all_difficulties()

    parser.add_argument("--lib", choices=all_lib_ids,
                        help="Only process this lib (manifest id).")
    parser.add_argument("--difficulty", choices=all_diffs,
                        help="Only process this difficulty.")
    parser.add_argument("--target-size", type=int,
                        help="Override manifest defaults.bucket_target_size for this run.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print plan without calling OpenAI or writing.")
    args = parser.parse_args()

    setup_env()
    cfg = load_config()
    cfg.require_ai()  # raise clearly if AI_* unset, with a pointer at .env.db

    target = args.target_size or manifest.bucket_target_size()

    # Difficulty filter:
    #   - if --difficulty given, only that one
    #   - else, the union of all libs' difficulties (preserves first-seen order)
    diffs = (args.difficulty,) if args.difficulty else all_diffs

    print(f"[generate_sentences] manifest version={manifest.version}")
    print(f"[generate_sentences] target_size per (lib, difficulty): {target}")
    print(f"[generate_sentences] difficulties: {', '.join(diffs)}")
    print(f"[generate_sentences] mode: {'dry-run' if args.dry_run else 'fill'}")
    print()

    # Load the prompt template once (yaml parse), pass into each call.
    prompt = _load_prompt()

    # Libs to process: filter by manifest + DB. We require the lib to exist in
    # BOTH the manifest AND the DB; if a manifest lib has no DB row, it's a
    # sync miss -- print and skip (don't fail).
    target_lib_ids = (args.lib,) if args.lib else all_lib_ids
    manifest_libs_by_id = {lib.id: lib for lib in manifest.all_libs()}

    with psycopg2.connect(cfg.database_url) as conn:
        db_libs = list_libs(conn)
        db_libs_by_level = {level: (lib_id, name) for lib_id, level, name in db_libs}

        results = []
        for lib_id in target_lib_ids:
            lib = manifest_libs_by_id.get(lib_id)
            if lib is None:
                print(f"  ?? {lib_id}: not in manifest -- skipping")
                continue
            if lib_id not in db_libs_by_level:
                print(f"  !! {lib_id}: in manifest but not imported -- run content.sh sync first")
                continue
            db_lib_id, db_name = db_libs_by_level[lib_id]
            # Use the per-lib difficulty list, not the global union. If --difficulty
            # was passed, only that one (already validated by argparse `choices`).
            lib_diffs = (args.difficulty,) if args.difficulty else lib.difficulties
            for d in lib_diffs:
                results.append(fill_bucket(conn, cfg, db_lib_id, db_name, d, target, args.dry_run, prompt))

    # Summary
    for r in results:
        marker = "+" if (isinstance(r["inserted"], int) and r["inserted"] > 0) else "."
        print(f"  {marker} {r['lib']:14s} {r['difficulty']:13s} needed={r['needed']:>4}  inserted={r['inserted']}")


if __name__ == "__main__":
    main()