/**
 * Landing mock data — static fallback for the home page's content-driven
 * sections (Hero daily plan, lib carousel picks, daily word/sentence).
 *
 * The plan calls for a `/api/landing` endpoint; until that lands, the
 * page composes from this file + `getContentCatalog()` results. Keep
 * the shape here aligned with the future endpoint contract so swapping
 * to `fetch('/api/landing')` is a one-line change in `lib/landingData.ts`.
 */
import { VocabularyLib, TranslationProgress, LessonSentence, WordInLesson } from '../api';

export interface DailyWord {
  word: string;
  phonetic: string;
  translation: string;
  example: string;
  exampleTranslation: string;
  audio_url?: string;
}

export interface DailySentence {
  text: string;
  chinese_text: string;
  audio_url?: string;
  difficulty: string;
}

export interface LandingData {
  recommended_lib_id: string;
  daily_word: DailyWord;
  daily_sentence: DailySentence;
  /** Count of wrong/right per-lib for the "本周计划" stat. */
  weekly_plan: {
    continue_lib_id?: string;
    new_lib_id: string;
    review_count: number;
  };
}

/* ------------------------------------------------------------------ */
/* Carousel picks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pick a small set of libs for the hero carousel: first the highest
 * level (headline pick), then a couple of mid-tier. Stable order is
 * nice-to-have; we sort by `level` heuristically (a1 → c2).
 */
const LEVEL_RANK: Record<string, number> = {
  a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6,
};

function rankLevel(level: string): number {
  return LEVEL_RANK[level.toLowerCase()] ?? 0;
}

export function pickCarouselLibs(libs: VocabularyLib[]): VocabularyLib[] {
  if (libs.length === 0) return [];
  const sorted = [...libs].sort((a, b) => rankLevel(b.level) - rankLevel(a.level));
  // Top one + next two in catalog order. If fewer libs, take what's there.
  return sorted.slice(0, Math.min(3, sorted.length));
}

/* ------------------------------------------------------------------ */
/* Daily plan math (zero-backend)                                     */
/* ------------------------------------------------------------------ */

export interface LibProgressStat {
  answered: number;
  correct: number;
  wrong: number;
  total: number;
  percent: number;
}

/**
 * Aggregate per-lib stats from a translation progress blob. Walks the
 * lib's `sentences` map — no need to refetch the lesson to render
 * summary numbers on the landing page.
 */
export function summarizeProgress(
  progress: TranslationProgress,
  libId: string,
  totalSentences: number
): LibProgressStat {
  const lib = progress[libId];
  const sentences = lib?.sentences ?? {};
  let answered = 0;
  let correct = 0;
  let wrong = 0;
  for (const id in sentences) {
    const s = sentences[id];
    if (!s) continue;
    answered += 1;
    if (s.correct) correct += 1;
    else wrong += 1;
  }
  return {
    answered,
    correct,
    wrong,
    total: totalSentences,
    percent: totalSentences > 0 ? Math.round((correct / totalSentences) * 100) : 0,
  };
}

/**
 * Count wrong sentences across all libs — for the "错题回炉" card.
 */
export function countTotalWrong(progress: TranslationProgress): number {
  let n = 0;
  for (const libId in progress) {
    const lib = progress[libId];
    if (!lib) continue;
    for (const sid in lib.sentences) {
      if (lib.sentences[sid] && !lib.sentences[sid].correct) n += 1;
    }
  }
  return n;
}

/**
 * The most recently picked lib (from `prefs.libId` in localStorage).
 * Returns `null` if unset / private mode throws.
 */
export function readRecentLibId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('prefs.libId');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Static fallbacks — used only when /api/landing isn't reachable    */
/* and we have no other data (cold start, no catalog).               */
/* ------------------------------------------------------------------ */

export const FALLBACK_DAILY_WORD: DailyWord = {
  word: 'serendipity',
  phonetic: '/ˌserənˈdɪpəti/',
  translation: '意外发现美好事物的能力',
  example: 'Meeting her at the café was pure serendipity.',
  exampleTranslation: '在咖啡馆遇见她完全是意外之喜。',
};

export const FALLBACK_DAILY_SENTENCE: DailySentence = {
  text: 'The early morning light filtered softly through the curtains.',
  chinese_text: '清晨的微光柔和地透过窗帘洒进来。',
  difficulty: 'B1',
};

export const FALLBACK_RECOMMENDED_LIB_ID = 'cet4';

/* ------------------------------------------------------------------ */
/* Derive LandingData from a live catalog + a live sentence sample.  */
/* If those are empty (cold start), return the static fallback.      */
/* ------------------------------------------------------------------ */

export interface LandingInputs {
  libs: VocabularyLib[];
  /** First sentence from a "recommended" lib — used as daily sentence. */
  recommendedSentence?: LessonSentence | null;
  /** First word from that same lib — used as daily word. */
  recommendedWord?: WordInLesson | null;
  progress: TranslationProgress;
}

export function composeLandingData(input: LandingInputs): LandingData {
  const { libs, recommendedSentence, recommendedWord, progress } = input;
  const recentLibId = readRecentLibId();

  // Pick a "new" lib for the 新词速通 card: prefer the first lib that's
  // not the most-recently-picked one. Fallback to the first lib.
  const newLib =
    (recentLibId && libs.find((l) => l.id !== recentLibId)) || libs[0];

  const dailyWord: DailyWord = recommendedWord
    ? {
        word: recommendedWord.word,
        phonetic: recommendedWord.phonetic || '',
        translation: recommendedWord.translation || '',
        example: recommendedSentence?.text || '',
        exampleTranslation: recommendedSentence?.chinese_text || '',
        audio_url: recommendedSentence?.audio_url || undefined,
      }
    : FALLBACK_DAILY_WORD;

  const dailySentence: DailySentence = recommendedSentence
    ? {
        text: recommendedSentence.text,
        chinese_text: recommendedSentence.chinese_text || '',
        audio_url: recommendedSentence.audio_url || undefined,
        difficulty: recommendedSentence.difficulty || 'B1',
      }
    : FALLBACK_DAILY_SENTENCE;

  return {
    recommended_lib_id: recentLibId || newLib?.id || FALLBACK_RECOMMENDED_LIB_ID,
    daily_word: dailyWord,
    daily_sentence: dailySentence,
    weekly_plan: {
      continue_lib_id: recentLibId ?? undefined,
      new_lib_id: newLib?.id || FALLBACK_RECOMMENDED_LIB_ID,
      review_count: countTotalWrong(progress),
    },
  };
}
