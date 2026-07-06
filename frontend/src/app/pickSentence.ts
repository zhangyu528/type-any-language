/**
 * pickSentence — choose one sentence from a word's sentence pool for a given
 * difficulty preference. Shared by LessonSession (the dictation ladder) and
 * TranslationSession (the standalone translation mode).
 *
 * Why a separate module:
 *   - Both orchestrators want the same picking semantics
 *     (beginner exact → fallback to non-beginner → fallback to first)
 *   - Centralizes the "skip beginner if possible for stage 2" rule
 *
 * The implementation is byte-identical to what was previously inline in
 * LessonSession.tsx; just hoisted to be importable.
 */

import type { LessonSentence } from './api';

export type SentenceDifficulty = 'beginner' | 'intermediate';

/**
 * Pick a sentence matching the requested difficulty, with sensible fallbacks.
 *
 * @param sentences — the per-word pool from `LessonDetail.sentences_by_word`.
 *                    May be undefined or empty if the word has no baked
 *                    sentences yet.
 * @param difficulty — the preferred difficulty bucket.
 * @returns the picked sentence, or undefined if the pool is empty.
 */
export function pickSentence(
  sentences: LessonSentence[] | undefined,
  difficulty: SentenceDifficulty
): LessonSentence | undefined {
  if (!sentences || sentences.length === 0) return undefined;
  const exact = sentences.find((s) => s.difficulty === difficulty);
  if (exact) return exact;
  if (difficulty === 'beginner') {
    // No beginner sentence: take any.
    return sentences[0];
  }
  // Intermediate fallback: skip beginner if possible (more substance for
  // a dictation cell), otherwise take whatever's there.
  return (
    sentences.find((s) => s.difficulty !== 'beginner') ?? sentences[0]
  );
}