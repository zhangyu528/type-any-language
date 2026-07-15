#!/usr/bin/env python3
"""
build_ielts_csv.py — convert fanhongtao/IELTS word list (txt) into the
project's 4-column CSV format.

Source format (one entry per line, word List NN headers skipped):
    emperor   /ˈempərə(r)/ n. 皇帝；君主
    exact*    /ɪgˈzækt/    a. 精确的；准确的
    pretentious /prɪˈtenʃəs/ a. 自命不凡的，自负的；...
    curbside /ˏkɜːbˈsaɪd/  n. 路边；人行道的边缘

Project format (the rest of cms/seed/vocabulary/*.csv):
    word,phonetic,translation,part_of_speech
    boat,,小船；轮船 v. 划船,n
    group,,组；团体 adj. 群的；团体的 v. 聚合,n
    party,,政党；... [复数 parties] v. 参加社交聚会 [...],n

phonetic column is intentionally empty in this project (the audio TTS
pipeline doesn't use it). part_of_speech is the FIRST POS letter found
in the translation (n / v / a / ad / vt / vi / prep / conj / num /
pron / interj / art) — single-letter to match beginner.csv style.

Output: cms/seed/vocabulary/ielts.csv (LF line endings, no BOM).

Source: https://github.com/fanhongtao/IELTS/blob/master/IELTS%20Word%20List.txt
Author: 新东方《雅思词汇词根+联想记忆法（乱序便携版）》
The source is published for personal study by 范洪滔 under the
assumption that the underlying word list is itself a paraphrase of
the book's glossary. The project uses it for personal learning
purposes; commercial use would require licensing the original book.
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

# Resolve from `os.getcwd()` instead of `Path(__file__).parent...` because
# the script lives at scripts/build_ielts_csv.py — a fixed anchor that's
# wrong when this file is symlinked or vendored. `os.getcwd()` matches
# the project root that the operator `cd`-ed into before running the
# converter, which is what they actually want.
ROOT = Path(os.getcwd()).resolve()
SOURCE_TXT = Path(tempfile.gettempdir()) / "ielts" / "wordlist.txt"
OUTPUT_CSV = ROOT / "cms" / "source" / "vocabulary" / "ielts.csv"

# A word line, captured:
#   group 1 = the word (with optional trailing *)
#   group 2 = the IPA block (without surrounding brackets/slashes)
#   group 3 = the rest = translation (starts with POS marker)
LINE_RE = re.compile(
    r"""
    ^([^\s/[{]+?)              # word (no whitespace, no /, no [, no {)
    \s+                         # whitespace separator
    [/\[{]                      # IPA opening: / [ or {
    ([^/\]}]+)                  # IPA body (no closing bracket of any kind)
    [/\]}]                      # IPA closing
    \s+                         # whitespace separator
    (.+)$                       # translation (everything else)
    """,
    re.VERBOSE,
)

# POS markers that can appear at the start of a translation. Single-letter
# abbreviations the project uses (see beginner.csv). Multi-word markers
# like "vt." / "vi." / "prep." are reduced to their first letter to
# match the project's existing style (the column is loosely-populated,
# not a strict POS taxonomy).
#
# IMPORTANT — ordered longest-prefix-first:
#   "ad." (adverb) must come before "a." (adjective) so that
#   "ad. 仅仅..." parses as ad (adverb), not a (adjective).
#   "num." must come before "n." so that "num. 二十" parses as
#   n (the project's existing abbreviation for numerals), not n.
# Same for "adv." (adverb old-style) vs "adj." (adjective old-style).
POS_MARKERS = (
    # Compound POS forms first — the source uses these when a word is
    # two parts of speech at once ("n./vt." = noun + transitive verb).
    # The source uses TWO conventions: with trailing period on second
    # ("n./vt.") and without ("n./v."). Cover both. Record the first
    # one (matches beginner.csv's "take the first POS" convention).
    ("n./vt.", "n"),
    ("n./vi.", "n"),
    ("n./v.", "n"),
    ("n./a.", "n"),
    ("n./ad.", "n"),
    ("v./n.", "v"),
    ("vt./vi.", "v"),
    ("vi./vt.", "v"),
    ("vt./n.", "v"),
    ("vi./n.", "v"),
    ("v./vi.", "v"),
    ("v./vt.", "v"),
    ("a./ad.", "a"),
    ("a./n.", "a"),
    ("a./v.", "a"),
    ("excl.", "i"),      # exclamation = interjection in the project
    ("prep.", "p"),
    ("conj.", "c"),
    ("pron.", "r"),
    ("interj.", "i"),
    ("art.", "a"),
    ("adv.", "ad"),
    ("adj.", "a"),
    ("num.", "n"),
    ("ad.", "ad"),
    ("vt.", "v"),
    ("vi.", "v"),
    ("aux.", "v"),
    ("prep", "p"),
    ("conj", "c"),
    ("pron", "r"),
    ("n.", "n"),
    ("v.", "v"),
    ("a.", "a"),
)

# A word line starts with an ASCII letter (no CJK, no whitespace, no
# bracket of any kind). README prose lines in the source file start
# with Chinese characters; we skip those.
ASCII_LETTER_RE = re.compile(r"^[A-Za-z]")


def parse_line(line: str) -> tuple[str, str, str, str] | None:
    """Return (word, phonetic, translation, pos) or None if unparseable.

    Strip a trailing asterisk on the word (the source uses `word*` to mark
    exam-required words; the project has no such distinction).
    """
    line = line.rstrip()
    if not line:
        return None
    # Source has a README preamble in Chinese — those lines happen to
    # match our line regex (look like "word IPA translation"), so we
    # explicitly skip any line whose "word" starts with a CJK character.
    if not ASCII_LETTER_RE.match(line):
        return None
    m = LINE_RE.match(line)
    if not m:
        return None
    word, ipa, translation = m.group(1), m.group(2), m.group(3).strip()
    # Strip trailing asterisk on the word ("exact*", "emperor", ...).
    if word.endswith("*"):
        word = word[:-1]
    word = word.strip()
    # Normalize the start of the translation for POS lookup:
    #   - the source has at least one full-width 'n.' (U+FF4E.U+FF0E) in
    #     a word where the kanji line was likely re-encoded from a
    #     different codepage; normalize full-width → ASCII so the table
    #     below works uniformly.
    pos_prefix = translation
    for fw, ascii_ in (("ｎ", "n"), ("ｖ", "v"), ("ａ", "a"),
                       ("ａｄ", "ad"), ("ｐ", "p"), ("ｃ", "c")):
        pos_prefix = pos_prefix.replace(fw, ascii_)
    # Derive part_of_speech: the first POS marker at the very start of
    # the translation. Translations may include "n. ... v. ..." for verbs
    # that double as nouns; we record the first one as the canonical POS
    # (matching beginner.csv's "n", "v", "adj", "num" pattern).
    # Match either `<marker> ` (standard) or `<marker>(` (rare case where
    # the translation starts the gloss without a space — e.g. "excl.(...)").
    pos = ""
    for marker, code in POS_MARKERS:
        if pos_prefix.startswith(marker + " ") or pos_prefix.startswith(marker + "(") \
                or pos_prefix == marker.rstrip("."):
            pos = code
            break
    if not pos:
        # Default: leave blank. The project tolerates blank POS.
        pos = ""
    # Project uses `word,,translation,pos` — second column (phonetic) is
    # intentionally empty since the TTS pipeline doesn't read it.
    return (word, "", translation, pos)


def main() -> int:
    if not SOURCE_TXT.exists():
        print(f"ERROR: source not found at {SOURCE_TXT}", file=sys.stderr)
        print(f"  download with:", file=sys.stderr)
        print(f"    curl -sL https://raw.githubusercontent.com/fanhongtao/IELTS/master/IELTS%20Word%20List.txt > {SOURCE_TXT}", file=sys.stderr)
        return 1

    text = SOURCE_TXT.read_text(encoding="utf-8")
    seen: dict[str, tuple[str, str, str, str]] = {}  # word → row, for dedup
    skipped_header = 0
    skipped_blank = 0
    skipped_unparseable = 0

    for raw_line in text.splitlines():
        # Strip "Word List NN" headers and the README preamble.
        if raw_line.startswith("Word List ") or not raw_line.strip():
            skipped_header += 1
            continue
        # README prose lines (Chinese sentences) won't match LINE_RE.
        parsed = parse_line(raw_line)
        if parsed is None:
            skipped_blank += 1
            continue
        word, phonetic, translation, pos = parsed
        if not word or not translation:
            skipped_unparseable += 1
            continue
        # Dedup — first occurrence wins (source sometimes repeats words
        # across lists; pick the first).
        if word not in seen:
            seen[word] = (word, phonetic, translation, pos)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="\n") as f:
        for word, phonetic, translation, pos in seen.values():
            # CSV-escape: fields here contain commas (Chinese punctuation
            # like `；` doesn't, but mid-sentence `,` would). Use a
            # naive quote-if-needed approach (no embedded quotes / newlines
            # in this data).
            def quote(field: str) -> str:
                if "," in field or '"' in field or "\n" in field:
                    return '"' + field.replace('"', '""') + '"'
                return field
            f.write(f"{quote(word)},{quote(phonetic)},{quote(translation)},{pos}\n")

    print(f"Wrote {len(seen)} rows to {OUTPUT_CSV}")
    print(f"  skipped: {skipped_header} header/blank, {skipped_blank} non-data, {skipped_unparseable} unparseable")
    return 0


if __name__ == "__main__":
    sys.exit(main())