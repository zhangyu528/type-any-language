"""
Phonetic transcription service.

Two-step lookup:
1. vocabulary_words table (for target_words - already have authoritative phonetic)
2. CMUdict fallback (for any other English word in the sentence)

Returns IPA-style phonetic wrapped in slashes, e.g. "/əˈstrɑːməli/".
"""
import re
from typing import Dict, Iterable

import cmudict

_CMU = cmudict.dict()

# Map CMUdict ARPAbet phonemes to IPA
_ARPABET_TO_IPA = {
    # Vowels
    "AA": "ɑ", "AE": "æ", "AH": "ə", "AO": "ɔ", "AW": "aʊ",
    "AY": "aɪ", "EH": "ɛ", "ER": "ər", "EY": "eɪ", "IH": "ɪ",
    "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "u",
    # Consonants
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f",
    "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k", "L": "l",
    "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "r",
    "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v",
    "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
    # Punctuation
    "PUNC": "",
}


def _strip_punct(word: str) -> str:
    """Remove surrounding punctuation; lowercase."""
    return re.sub(r"^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$", "", word).lower()


def _arpabet_to_ipa(phones: Iterable[str]) -> str:
    """Convert ARPAbet phoneme list to IPA string with primary stress marks."""
    out = []
    for phone in phones:
        # Strip stress digit 0/1/2
        m = re.match(r"^([A-Z]+)([012])?$", phone)
        if not m:
            continue
        base, stress = m.group(1), m.group(2)
        ipa = _ARPABET_TO_IPA.get(base, "")
        if not ipa:
            continue
        # Apply stress marks for primary (1) and secondary (2) on vowels
        if stress == "1" and base in ("AA", "AE", "AH", "AO", "AW", "AY", "EH", "EY", "IH", "IY", "OW", "OY", "UH", "UW", "ER"):
            out.append("ˈ" + ipa)
        elif stress == "2" and base in ("AA", "AE", "AH", "AO", "AW", "AY", "EH", "EY", "IH", "IY", "OW", "OY", "UH", "UW", "ER"):
            out.append("ˌ" + ipa)
        else:
            out.append(ipa)
    return "".join(out)


def cmu_phonetic(word: str) -> str:
    """Look up a single word in CMUdict. Returns IPA wrapped in /.../, or '' if not found."""
    clean = _strip_punct(word)
    if not clean:
        return ""
    # Try the word as-is first
    entries = _CMU.get(clean) or _CMU.get(clean.capitalize())
    if not entries:
        return ""
    # entries is a list of pronunciations; use the first
    return "/" + _arpabet_to_ipa(entries[0]) + "/"


def get_phonetic_for_words(
    words: Iterable[str],
    vocab_lookup: Dict[str, str] | None = None,
) -> Dict[str, str]:
    """
    Resolve phonetics for a list of words.

    vocab_lookup: optional pre-built map {lower_word: phonetic} from the vocabulary_words table.
                  If provided, takes priority over CMUdict.

    Returns: {lower_word: phonetic} (only words that have a match).
    """
    vocab_lookup = vocab_lookup or {}
    result: Dict[str, str] = {}
    for word in words:
        key = _strip_punct(word)
        if not key:
            continue
        if key in vocab_lookup and vocab_lookup[key]:
            result[key] = vocab_lookup[key]
        else:
            ipa = cmu_phonetic(key)
            if ipa:
                result[key] = ipa
    return result
