const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Library / catalog
// ---------------------------------------------------------------------------
export interface VocabularyLib {
  id: string;
  name: string;
  level: string;
  word_count: number;
  /** Optional tagline shown on the home card. Null/undefined for libs baked
   *  before migration 0009. UI hides the line when missing. */
  description?: string | null;
}

export interface CatalogDefaults {
  difficulty: string;
  bucket_target_size: number;
}

export interface Catalog {
  libs: VocabularyLib[];
  difficulties_by_lib: Record<string, string[]>;
  defaults: CatalogDefaults;
}

export async function getContentCatalog(): Promise<Catalog> {
  const response = await fetch(`${API_BASE_URL}/api/content/catalog`);
  if (!response.ok) {
    throw new Error('获取内容目录失败');
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Lessons — Target-Word Lesson feature
//
// The dictation ladder UI was removed (LessonList / LessonSession /
// DictationStage / RecognitionStage) but the lesson data shape is what
// TranslationStage + TranslationSession consume. The future-facing lesson
// surface is now ONLY translation, but the underlying sentences / words
// load through the same API. Keep these types stable.
//
// (dictation ladder — see git history if you need it back)
// ---------------------------------------------------------------------------
export interface LessonSummary {
  lesson_index: number;
  word_count: number;
}

export interface WordInLesson {
  id: string;
  word: string;
  phonetic: string;
  translation: string;
}

export interface LessonSentence {
  id: string;
  text: string;
  chinese_text: string;
  difficulty: string;
  audio_url: string;
}

export interface LessonDetail {
  lib_id: string;
  lesson_index: number;
  words: WordInLesson[];
  sentences_by_word: Record<string, LessonSentence[]>;
}

export async function listLessons(libId: string): Promise<LessonSummary[]> {
  const params = new URLSearchParams({ lib_id: libId });
  const response = await fetch(`${API_BASE_URL}/api/lessons?${params}`);
  if (!response.ok) {
    throw new Error('获取课程列表失败');
  }
  return response.json();
}

/**
 * Fetch the entire lib's words + sentences in one round-trip.
 *
 * Used by the random-step drill (TranslationSession) — the "lesson"
 * intermediate layer is gone, so we no longer drill lesson-by-lesson;
 * instead the whole lib is one giant step pool.
 *
 * The response uses the same `LessonDetail` shape as the legacy
 * per-lesson endpoint; `lesson_index` is always 0 in this response
 * (sentinel — see backend `routers/lessons.py::get_lib_full`).
 */
export async function getLib(libId: string): Promise<LessonDetail> {
  const response = await fetch(`${API_BASE_URL}/api/lessons/${libId}/all`);
  if (!response.ok) {
    throw new Error('获取词库内容失败');
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Audio + phonetics
// ---------------------------------------------------------------------------
export function getAudioUrl(audioUrl: string): string {
  if (audioUrl.startsWith('http')) {
    return audioUrl;
  }
  return `${API_BASE_URL}${audioUrl}`;
}

export async function getPhonetics(words: string[]): Promise<Record<string, string>> {
  if (words.length === 0) return {};
  const params = new URLSearchParams({ words: words.join(',') });
  const response = await fetch(`${API_BASE_URL}/api/vocabulary/phonetics?${params}`);
  if (!response.ok) {
    throw new Error('查询音标失败');
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Translation progress (Standalone Translation Drill mode)
//
// Independent localStorage key — the only progress blob the app writes.
// Progress is per-lib (NOT per-lesson), keyed by sentence.id. The
// "lesson" intermediate layer was removed: clicking a lib goes
// straight into a random-step drill, so the lessonIndex grouping is
// gone too. The weighted-random draw in TranslationSession reads from
// `TranslationProgress[libId].sentences` to decide which step to
// show next.
//
// Legacy blob shape (per-word, dual-direction):
//   { words: { wordKey: { en2zhCorrect, zh2enCorrect } } }
// New shape (per-sentence, single-direction):
//   { sentences: { sentenceId: { correct: boolean } } }
//
// `loadTranslationProgress` drops `words` on read — the old shape
// cannot be losslessly mapped to the new one. The `TranslationLessonProgress`
// type still exists for the per-lesson write/read (used by
// TranslationSession) but its parent index has flattened from
// `libId → lessonIndex → TranslationLessonProgress` to
// `libId → TranslationLibProgress`.
//
// The `completedAt` field is preserved on the legacy lesson shape
// for backward read compat but is no longer written.
// ---------------------------------------------------------------------------
export type TranslationSentenceProgress = {
  /** 该句子的中文→英文翻译是否通过 */
  correct: boolean;
};

/** @deprecated Use TranslationSentenceProgress. Kept as a type alias
 *  for any callers still wired to the old per-word shape. */
export type TranslationWordProgress = TranslationSentenceProgress;

/**
 * Per-lesson progress (legacy grouping; no longer written by new code
 * but kept readable for backward compat). `completedAt` is ignored
 * by the new drill.
 */
export type TranslationLessonProgress = {
  /** key: sentence.id (string UUID). Each sentence in the lesson gets
   *  its own correct/incorrect state. */
  sentences: Record<string, TranslationSentenceProgress>;
  /** @deprecated — lessons no longer have a "completed" state. Random
   *  step practice is unbounded. Kept as `number | undefined` for
   *  backward read compat with old blobs (the value is just ignored). */
  completedAt?: number;
};

/**
 * Per-lib progress. All sentences for the lib live in one flat
 * `sentences` map; there's no lesson grouping anymore. Stored under
 * `TranslationProgress[libId]`.
 */
export type TranslationLibProgress = {
  sentences: Record<string, TranslationSentenceProgress>;
};

export type TranslationProgress = {
  [libId: string]: TranslationLibProgress;
};

const TRANSLATION_PROGRESS_KEY = 'translationProgress';

export function loadTranslationProgress(): TranslationProgress {
  try {
    const raw = window.localStorage.getItem(TRANSLATION_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Two-step normalisation:
    //  1. Drop legacy `words` key on per-lesson buckets.
    //  2. Flatten the { lessonIndex → bucket } grouping into a single
    //     per-lib bucket (the new shape no longer has lessonIndex
    //     because there's no lesson concept).
    const out: TranslationProgress = {};
    for (const libId in parsed) {
      const libBucket = parsed[libId];
      if (!libBucket || typeof libBucket !== 'object') continue;
      const lb = libBucket as {
        sentences?: Record<string, TranslationSentenceProgress>;
        // legacy fields
        [lessonIndex: string]: unknown;
      };
      // Collect all `sentences` maps from legacy lesson buckets AND
      // the new top-level `sentences` field. Merge them.
      const merged: Record<string, TranslationSentenceProgress> = {};
      if (lb.sentences && typeof lb.sentences === 'object') {
        Object.assign(merged, lb.sentences);
      }
      for (const key in lb) {
        if (key === 'sentences' || key === 'completedAt') continue;
        const legacyLesson = lb[key];
        if (
          legacyLesson &&
          typeof legacyLesson === 'object' &&
          'sentences' in (legacyLesson as object)
        ) {
          const lm = (legacyLesson as { sentences: Record<string, TranslationSentenceProgress> }).sentences;
          if (lm && typeof lm === 'object') {
            Object.assign(merged, lm);
          }
        }
      }
      out[libId] = { sentences: merged };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTranslationProgress(progress: TranslationProgress): void {
  try {
    window.localStorage.setItem(
      TRANSLATION_PROGRESS_KEY,
      JSON.stringify(progress)
    );
  } catch {
    /* 隐私模式静默 */
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
//
// All five exports live here as a single client layer because they share
// the same surface: HTTP + cookie + ApiError. The /login + /signup pages
// use these directly; the <AuthProvider> (lib/auth.tsx) uses apiMe on
// mount to hydrate global user state.

/** Public user projection. Mirrors backend's UserPublic schema. */
export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  created_at: string; // ISO timestamp from the backend
}

/**
 * ApiError — custom error type that wraps HTTP failures with a
 * structured payload. Use `err instanceof ApiError` then read
 * `.status`, `.message`, and (for signup/login) `.fieldErrors`.
 *
 * - 4xx / 5xx responses: throw ApiError with parsed body
 * - network failures (fetch rejects): re-thrown as-is so callers
 *   can show a "no network" toast without instanceof checks
 */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Internal: parse a fetch Response into JSON or throw ApiError.
 * Used by all four auth functions below so the error shape is uniform.
 */
async function parseOrThrow(res: Response): Promise<unknown> {
  let body: { detail?: string; field_errors?: Record<string, string> } | null = null;
  try {
    body = await res.json();
  } catch {
    // body wasn't JSON; fall through with null
  }
  if (res.ok) return body;
  const message = body?.detail ?? `HTTP ${res.status}`;
  throw new ApiError(res.status, message, body?.field_errors);
}

/** POST /api/auth/signup. Returns the new user. Server sets the cookie. */
export async function apiSignup(input: {
  email: string;
  password: string;
  display_name?: string;
}): Promise<AuthUser> {
  const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      ...(input.display_name ? { display_name: input.display_name } : {}),
    }),
    credentials: 'include',
  });
  const body = (await parseOrThrow(res)) as AuthUser;
  return body;
}

/** POST /api/auth/login. Returns the user. Server sets the cookie. */
export async function apiLogin(input: { email: string; password: string }): Promise<AuthUser> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });
  const body = (await parseOrThrow(res)) as AuthUser;
  return body;
}

/** POST /api/auth/logout. Throws on network failure; otherwise resolves void. */
export async function apiLogout(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 401) {
    await parseOrThrow(res);
  }
}

/**
 * GET /api/auth/me. **Does NOT throw on 401** — returns null instead.
 * That's the difference from the auth endpoints: anonymous is a state
 * the <AuthProvider> needs to know about, not an error. Network
 * failures still reject (the caller's catch will see a TypeError,
 * not an ApiError, and can show a "no network" UI).
 */
export async function apiMe(): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    credentials: 'include',
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    // Treat any other non-ok as null too — better UX than a hard
    // throw on first render. (e.g. backend down shouldn't log
    // every user out.)
    return null;
  }
  const body = (await res.json()) as { user: AuthUser | null };
  return body.user;
}
