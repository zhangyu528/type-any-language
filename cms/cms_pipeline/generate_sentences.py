#!/usr/bin/env python3
"""
generate_sentences.py — bulk-generate sentence JSONL files from vocab
JSON files. Pure file producer: does NOT touch the db.

Data flow:
    cms/content/vocabulary/<lib>.json    ← import_vocab output
        ↓
    [generate_sentences.py]                    ← THIS MODULE
        ↓
    cms/content/sentences/<lib>.jsonl   ← one sentence per line
        ↓
    [db/scripts/import_staging.sh + dbtools.importer]
        ↓
    sentences table (audio_url is empty; generate_audio.py fills it in)

Output JSONL format (one sentence per line, all metadata):
    {
      "text": "The boat is small.",
      "chinese_text": "船很小。",
      "target_words": ["boat", "small"],
      "difficulty": "beginner",
      "topic": "...",
      "register": "...",
      "cefr": "A1",
      "tags": ["idiom", "phrasal-verb"]
    }

Why this is a file producer (not a db writer):
  - CMS pipeline doesn't know db exists. It produces JSONL files
    that the db side imports separately.
  - Failed re-runs of import_staging.sh don't need to re-run the
    expensive AI step (the JSONL is already on disk).
  - The matching `dbtools.importer` reads the JSONL and UPSERTs
    into the sentences table.

How "which words need sentences" is decided:
  - "Covered" = the word appears in any sentence's target_words
    list in the existing JSONL (or in the merged vocab→sentences
    state, if you re-run)
  - "Need sentences" = NOT covered in any difficulty yet
  - Each (lib, difficulty) bucket has its own coverage. A word
    with a beginner-level sentence is still "uncovered" at the
    intermediate level.

Why this is simpler than the old db-based design:
  - We don't need a SELECT against sentence_word_links. We just
    look at the JSONL's text → target_words and dedupe.
  - No FK resolution — the importer (db side) handles that
    later, when it has the lib_id from vocabulary_libs.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from cms_pipeline.manifest import load_manifest
else:
    from .manifest import load_manifest


# Path conventions
STAGING_VOCAB_DIRNAME = "vocabulary"
STAGING_SENTENCES_DIRNAME = "sentences"


def find_project_root() -> Path:
    """Project root = 4 hops up from cms/cms_pipeline/generate_sentences.py."""
    return Path(__file__).resolve().parent.parent.parent


def find_content_dir() -> Path:
    """Where vocab/sentences files go. Default: cms/content/.

    Override via CMS_CONTENT_DIR (rare; for tests).
    """
    env = os.environ.get("CMS_CONTENT_DIR", "").strip()
    if env:
        return Path(env)
    return find_project_root() / "cms" / "staging"


# --- AI bits (kept from the old implementation) ---

def _load_prompt(path: Path | None = None) -> dict:
    """Load LLM prompt template from cms/seed/prompts/sentences.yaml."""
    import yaml
    prompt_path = path or (find_project_root() / "cms" / "seed" / "prompts" / "sentences.yaml")
    with prompt_path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("prompts", data)


def _render(template: str, vars: dict) -> str:
    """Jinja-style {{var}} substitution. (Reused unchanged.)"""
    out = template
    for k, v in vars.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out


def build_prompt(words: list[str], difficulty: str, lib_name: str,
                  prompt: dict) -> list[dict]:
    """Build chat-completions messages. (Same as old version.)"""
    vars = {
        "count": len(words),
        "word_list": ", ".join(words),
        "difficulty": difficulty,
    }
    return [
        {"role": "system", "content": _render(prompt["system"], vars).strip()},
        {"role": "user", "content": _render(prompt["user"], vars).strip()},
    ]


def call_openai(ai_cfg, words: list[str], difficulty: str, lib_name: str,
                prompt: dict) -> list[dict]:
    """Call OpenAI and parse the JSON response. (Same as old version.)"""
    from openai import OpenAI
    client = OpenAI(api_key=ai_cfg["api_key"], base_url=ai_cfg["base_url"])
    messages = build_prompt(words, difficulty, lib_name, prompt)
    response = client.chat.completions.create(
        model=ai_cfg["model"],
        messages=messages,
        temperature=0.7,
        # MiniMax-M3 (and other reasoning-enabled models) emit a  block
        # before the JSON, which can eat a big chunk of the token budget.
        # Asking for 200 sentences × ~25 tokens/sentence + a multi-paragraph
        # think block already exceeds 8k. Bump to 16k so the JSON survives
        # even for a maxed-out (lib, difficulty) bucket.
        max_tokens=16000,
    )
    content = response.choices[0].message.content or ""
    # MiniMax-M3 emits a "thinking" block before the JSON. Scan
    # forward to the first "{" then json.JSONDecoder.raw_decode from
    # there — handles nesting correctly (unlike first-/last-brace
    # slice) and ignores prose / think blocks / stray angle brackets.
    decoder = json.JSONDecoder()
    start = content.find("{")
    if start < 0:
        return []
    try:
        parsed, _ = decoder.raw_decode(content, start)
    except json.JSONDecodeError:
        return []
    sentences = parsed.get("sentences", [])
    if not isinstance(sentences, list):
        raise ValueError("OpenAI response missing 'sentences' list")
    return sentences


def _parse_tags(raw) -> list[str] | None:
    """LLM may return tags as either a JSON list[str] or a semicolon-joined
    string. Tolerate both. Returns None if no tags."""
    if raw is None:
        return None
    if isinstance(raw, list):
        out = [str(t).strip() for t in raw if str(t).strip()]
        return out or None
    if isinstance(raw, str):
        out = [t.strip() for t in raw.split(";") if t.strip()]
        return out or None
    return None


# --- Staging file I/O ---

def read_vocab_words(vocab_path: Path) -> list[str]:
    """Read vocabulary/<lib>.json → list of word strings."""
    data = json.loads(vocab_path.read_text(encoding="utf-8"))
    return [w["word"] for w in data.get("words", [])]


def read_existing_sentences(sentences_path: Path) -> list[dict]:
    """Read sentences/<lib>.jsonl → list of {text, target_words, ...}.
    Returns [] if file doesn't exist yet."""
    if not sentences_path.is_file():
        return []
    out = []
    for line in sentences_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        s = json.loads(line)
        out.append(s)
    return out


def covered_target_words(sentences: list[dict]) -> set[str]:
    """Union of all target_words across the given sentences (lowercased)."""
    covered: set[str] = set()
    for s in sentences:
        for w in (s.get("target_words") or []):
            covered.add(w.lower())
    return covered


def pick_uncovered_words(all_words: list[str], covered: set[str], n: int) -> list[str]:
    """Pick up to n words from all_words that aren't in covered.

    Words are already lowercased in the vocab file. We shuffle for
    diversity (the LLM benefits from seeing different subsets each
    time). Deterministic when called with the same seed (we don't
    seed here — the LLM gets a different prompt each run, which is
    desirable for variety).
    """
    import random
    pool = [w for w in all_words if w.lower() not in covered]
    random.shuffle(pool)
    return pool[:n]


def append_to_jsonl(path: Path, items: list[dict]) -> None:
    """Append items to a JSONL file. One JSON object per line, ending in \\n.

    Used to grow the sentences file over multiple runs. We don't
    dedupe here — the importer (db side) handles dedupe via the
    (lib_id, text, difficulty) ON CONFLICT DO NOTHING.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")


# --- Main pipeline ---

def fill_one_bucket(staging: Path, lib_id: str, lib_name: str, lib_level: str,
                    difficulty: str, target_size: int, prompt: dict,
                    ai_cfg: dict, dry_run: bool) -> dict:
    """Generate up to `target_size` sentences for one (lib, difficulty) pair.

    Reads vocab from staging/vocabulary/<level>.json + existing
    sentences from staging/sentences/<level>.jsonl. Writes new
    sentences back to the same JSONL.
    """
    vocab_path = staging / STAGING_VOCAB_DIRNAME / f"{lib_level}.json"
    sentences_path = staging / STAGING_SENTENCES_DIRNAME / f"{lib_level}.jsonl"

    if not vocab_path.is_file():
        return {"lib": lib_name, "difficulty": difficulty, "status": "missing-vocab"}

    all_words = read_vocab_words(vocab_path)
    if not all_words:
        return {"lib": lib_name, "difficulty": difficulty, "status": "empty-vocab"}

    existing = read_existing_sentences(sentences_path)
    covered = covered_target_words(existing)
    need = max(0, target_size - len(covered))
    if need == 0:
        return {
            "lib": lib_name, "difficulty": difficulty,
            "status": "full", "have": len(covered), "needed": 0,
        }

    targets = pick_uncovered_words(all_words, covered, need)
    if not targets:
        return {
            "lib": lib_name, "difficulty": difficulty,
            "status": "exhausted", "have": len(covered), "covered": len(covered),
        }

    if dry_run:
        return {
            "lib": lib_name, "difficulty": difficulty,
            "status": "plan", "have": len(covered), "needed": need,
            "would_ask": len(targets),
        }

    # Ask the model in chunks of ~50 words at a time. MiniMax-M3 emits
    # a multi-paragraph "thinking" block before the JSON that can
    # eat 8k+ tokens; ask 200 in one shot and the whole 16k token
    # cap is consumed before any sentences appear. Multiple smaller
    # calls each get a fresh think allocation and survive.
    CHUNK = 50
    ai_items: list[dict] = []
    for chunk_start in range(0, len(targets), CHUNK):
        chunk = targets[chunk_start:chunk_start + CHUNK]
        chunk_items = call_openai(ai_cfg, chunk, difficulty, lib_name, prompt)
        if chunk_items:
            ai_items.extend(chunk_items)
    # Normalize the AI's output (drop empty, lowercase target_words,
    # parse tags) before persisting.
    normalised: list[dict] = []
    seen_texts = {s["text"] for s in existing}  # dedupe vs. file
    for item in ai_items:
        text = (item.get("text") or "").strip()
        if not text or text in seen_texts:
            continue
        seen_texts.add(text)
        normalised.append({
            "text": text,
            "chinese_text": (item.get("chinese_text") or "").strip(),
            "target_words": [
                w.lower() for w in (item.get("target_words") or [])
                if isinstance(w, str) and w
            ],
            "difficulty": difficulty,
            "topic": (item.get("topic") or "").strip(),
            "register": (item.get("register") or "").strip(),
            "cefr": (item.get("cefr") or "").strip(),
            "tags": _parse_tags(item.get("tags")),
        })
    append_to_jsonl(sentences_path, normalised)
    return {
        "lib": lib_name, "difficulty": difficulty,
        "status": "written", "added": len(normalised),
        "have_after": len(covered) + len(normalised),
    }


def _read_ai_cfg() -> dict:
    """Read AI configuration from the process environment.

    Values are populated by ``scripts/secrets/fetch_secrets.sh eval-cms``
    (GitHub Environments secrets). There is no longer a local cms/.env
    fallback — process env is the only source.
    """
    if __package__ in (None, ""):
        from cms_pipeline.env import load_config
    else:
        from .env import load_config

    cfg = load_config()
    cfg.require_ai()
    return {
        "api_key": cfg.ai_api_key,
        "base_url": cfg.ai_base_url,
        "model": cfg.ai_model,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bulk-generate sentence JSONL files (no db write).",
    )
    parser.add_argument(
        "--lib", help="Only process this lib (manifest id).")
    parser.add_argument(
        "--difficulty", help="Only process this difficulty.")
    parser.add_argument(
        "--target-size", type=int,
        help="Override manifest defaults.bucket_target_size for this run.")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print plan without calling OpenAI or writing files.")
    args = parser.parse_args()

    manifest = load_manifest()
    all_lib_ids = manifest.all_lib_ids()
    all_diffs = manifest.all_diffs() if hasattr(manifest, "all_diffs") else (
        "beginner intermediate advanced"
    ).split()

    target = args.target_size or (
        manifest.defaults.bucket_target_size
        if hasattr(manifest, "defaults") else 200
    )
    diffs = (args.difficulty,) if args.difficulty else all_diffs
    target_lib_ids = (args.lib,) if args.lib else all_lib_ids
    manifest_libs_by_id = {lib.id: lib for lib in manifest.all_libs()}

    content = find_content_dir()
    if not args.dry_run:
        (staging / STAGING_SENTENCES_DIRNAME).mkdir(parents=True, exist_ok=True)

    prompt = _load_prompt()
    ai_cfg = None if args.dry_run else _read_ai_cfg()

    print(f"[generate_sentences] staging:   {staging}")
    print(f"[generate_sentences] target:     {target} per (lib, difficulty)")
    print(f"[generate_sentences] libs:       {', '.join(target_lib_ids)}")
    print(f"[generate_sentences] diffs:      {', '.join(diffs)}")
    print(f"[generate_sentences] mode:       {'dry-run' if args.dry_run else 'fill'}")
    print()

    results = []
    for lib_id in target_lib_ids:
        lib = manifest_libs_by_id.get(lib_id)
        if lib is None:
            print(f"  ?? {lib_id}: not in manifest — skipping")
            continue
        if not lib.csv_exists:
            # csv_exists was the OLD check; new check is the staging vocab file
            vocab_path = staging / STAGING_VOCAB_DIRNAME / f"{lib.level}.json"
            if not vocab_path.is_file():
                print(f"  !! {lib.level}: no staging vocab — run import_vocab first")
                continue
        for d in (diffs if args.difficulty else lib.difficulties):
            if d not in diffs:
                continue
            results.append(fill_one_bucket(
                staging, lib_id, lib.display, lib.level, d, target,
                prompt, ai_cfg, args.dry_run,
            ))

    for r in results:
        st = r["status"]
        if st == "missing-vocab":
            print(f"  !! {r['lib']:14s} {r['difficulty']:13s} missing vocab JSON")
        elif st == "empty-vocab":
            print(f"  !! {r['lib']:14s} {r['difficulty']:13s} empty vocab JSON")
        elif st == "full":
            print(f"  ok {r['lib']:14s} {r['difficulty']:13s} full ({r['have']} covered)")
        elif st == "exhausted":
            print(f"  -- {r['lib']:14s} {r['difficulty']:13s} exhausted (all {r['covered']} words covered)")
        elif st == "plan":
            print(f"  -- {r['lib']:14s} {r['difficulty']:13s} plan: have={r['have']}, need={r['needed']}, would_ask={r['would_ask']}")
        elif st == "written":
            print(f"  ok {r['lib']:14s} {r['difficulty']:13s} +{r['added']}  (have {r['have_after']})")
        else:
            print(f"  ?? {r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())