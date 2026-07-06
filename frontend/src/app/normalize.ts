/**
 * normalize — shared answer-comparison helpers for the practice flow.
 *
 * Used by:
 *   - DictationStage.tsx (English direction: user types the English sentence)
 *   - TranslationStage.tsx (both directions: user types EN or ZH)
 *
 * The English rules mirror what the old backend `validate_answer()` did —
 * this is the authoritative normalize in the codebase today. The Chinese
 * rules are new and follow the same philosophy: lowercase, strip
 * whitespace + Unicode punctuation, compare.
 *
 * Why split into a separate module:
 *   - Single source of truth for "what counts as correct"
 *   - Translation and Dictation must agree on English normalization
 *     (a user who typed "She's here." in dictation should also pass
 *     "she's here" in translation, and vice versa)
 *   - Easy to unit-test (no React, no DOM)
 */

/**
 * Lowercase + strip everything but alphanumerics, apostrophes, and whitespace,
 * then collapse whitespace and trim. Mirrors the legacy backend comparator.
 */
export function normalizeEn(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lowercase + strip ASCII whitespace, CJK ideographic space (U+3000), and
 * all Unicode punctuation categories. No fuzzy / no character-set match —
 * the canonical `chinese_text` in the DB is the single source of truth.
 */
export function normalizeZh(s: string): string {
  return s
    .replace(/[\s　\p{P}]/gu, '')
    .toLowerCase();
}

/** Validate English input against a target English sentence. */
export function validateEn(input: string, target: string): boolean {
  return normalizeEn(input) === normalizeEn(target);
}

/** Validate Chinese input against a target Chinese sentence. */
export function validateZh(input: string, target: string): boolean {
  return normalizeZh(input) === normalizeZh(target);
}