// Browser-side API base. For same-origin prod this is "/" — nginx already
// routes /api/ -> backend, and the client code below appends the "/api"
// path segment itself, so a "/api" base would DOUBLE it (/api/api/...).
// Strip any trailing slash so a root base ("/") resolves to same-origin
// ("/api/...") instead of a protocol-relative "//api/..." URL. Falls back to
// the dev backend (localhost:8000) when unset.
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@type-any-language.local',
  display_name: 'Demo User',
  created_at: '2026-01-01T00:00:00Z',
};

const DEMO_LIBS: VocabularyLib[] = [
  {
    id: 'cet4',
    name: 'CET-4 核心词',
    level: 'CET-4',
    word_count: 2607,
    sentence_count: 1840,
    description: '大学英语四级高频词,日常会话够用',
  },
  {
    id: 'cet6',
    name: 'CET-6 进阶词',
    level: 'CET-6',
    word_count: 2345,
    sentence_count: 1620,
    description: '六级冲刺,学术阅读和职场沟通',
  },
  {
    id: 'business',
    name: '商务英语',
    level: 'B2',
    word_count: 1180,
    sentence_count: 940,
    description: '会议、邮件、谈判常用词汇与句式',
  },
];

const DEMO_CATALOG: Catalog = {
  libs: DEMO_LIBS,
  difficulties_by_lib: {
    cet4: ['A1', 'A2', 'B1'],
    cet6: ['B1', 'B2'],
    business: ['B2', 'C1'],
  },
  defaults: { difficulty: 'A2', bucket_target_size: 8 },
};

const DEMO_LESSON_DETAIL: LessonDetail = {
  lib_id: 'cet4',
  lesson_index: 0,
  words: [
    { id: 'w1', word: 'abandon', phonetic: '/əˈbændən/', translation: '放弃;抛弃' },
    { id: 'w2', word: 'ability', phonetic: '/əˈbɪləti/', translation: '能力;才能' },
    { id: 'w3', word: 'absolute', phonetic: '/ˈæbsəluːt/', translation: '绝对的;完全的' },
    { id: 'w4', word: 'academic', phonetic: '/ˌækəˈdemɪk/', translation: '学术的;学院的' },
    { id: 'w5', word: 'accept', phonetic: '/əkˈsept/', translation: '接受;同意' },
  ],
  sentences_by_word: {
    w1: [{ id: 's1', text: 'He abandoned his car in the snow.', chinese_text: '他把车丢在雪地里走了。', difficulty: 'A2', audio_url: '/demo/silence.mp3' }],
    w2: [{ id: 's2', text: 'She has the ability to solve hard problems.', chinese_text: '她有解决难题的能力。', difficulty: 'A2', audio_url: '/demo/silence.mp3' }],
    w3: [{ id: 's3', text: 'There is no absolute truth.', chinese_text: '没有绝对的真理。', difficulty: 'B1', audio_url: '/demo/silence.mp3' }],
    w4: [{ id: 's4', text: 'His academic record is excellent.', chinese_text: '他的学业成绩非常优秀。', difficulty: 'A2', audio_url: '/demo/silence.mp3' }],
    w5: [{ id: 's5', text: 'Please accept my apology.', chinese_text: '请接受我的歉意。', difficulty: 'A2', audio_url: '/demo/silence.mp3' }],
  },
};

const DEMO_DASHBOARD: DashboardSnapshot = {
  user: DEMO_USER,
  continue: {
    session_id: null,
    lib_id: null,
    lesson_index: null,
    current_sentence_position: 0,
    sentences_attempted: 0,
    preview: '',
    is_unfinished: false,
  },
  daily_goal: { target: 20, today_count: 7, today_date: '2026-08-10', pct: 0.35, completed: false },
  streak: { current: 3, longest: 12, today_done: false, active_days: ['2026-08-08', '2026-08-09'] },
  calendar: Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(2026, 7, i - 3);
    const iso = d.toISOString().slice(0, 10);
    const count = [0, 0, 12, 18, 0, 9, 21, 16, 0, 4, 0, 0, 0, 0][i];
    return {
      date: iso,
      sentences_count: count,
      accuracy: count > 0 ? 0.78 : null,
      goal_hit: count >= 20,
      is_future: d.getTime() > Date.now(),
      is_streak_node: count > 0,
    };
  }),
  monthly_goal: { target: 500, current: 187, year_month: '2026-08', achieved: false, on_track: true },
  progress: {
    sentences_today: { value: 7, delta: 2, label: '今日句子' },
    accuracy_7d: { value: 78, delta: 4, label: '近 7 天准确率' },
    streak: { value: 3, delta: 0, label: '连续天数' },
    new_words: { value: 24, delta: 6, label: '本周新词' },
  },
  generated_at: '2026-08-10T00:00:00Z',
};


// ---------------------------------------------------------------------------
// Library / catalog
// ---------------------------------------------------------------------------
export interface VocabularyLib {
  id: string;
  name: string;
  level: string;
  word_count: number;
  /** Total sentences in this lib (across all difficulty buckets).
   *  Backed by `Sentence.lib_id` COUNT(*) in the catalog endpoint. */
  sentence_count: number;
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
  if (DEMO_MODE) {
    return DEMO_CATALOG;
  }

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
  if (DEMO_MODE) {
    return [{ lesson_index: 0, word_count: DEMO_LESSON_DETAIL.words.length }];
  }

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
  if (DEMO_MODE) {
    return DEMO_LESSON_DETAIL;
  }

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
  if (DEMO_MODE || audioUrl.startsWith('http')) {
    return audioUrl;
  }
  return `${API_BASE_URL}${audioUrl}`;
}

export async function getPhonetics(words: string[]): Promise<Record<string, string>> {
  if (DEMO_MODE) {
    return {};
  }

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
  /** 该句子累计错误次数。答对后保留作历史记录,不再清零。
   *  旧 blob(无此字段)UI 降级为按 1 次展示。 */
  wrongCount?: number;
  /** 最近一次错误的时间戳(Date.now())。同上的兼容性处理:
   *  undefined 时 UI 不显示相对时间,只显示"错题"。 */
  lastWrongAt?: number;
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

/**
 * Sentinel user id for users who haven't logged in. Drill data
 * written under this key is shared across all anonymous visitors
 * on the same device — fine for a stateless device demo, and
 * matches the pre-fix behaviour (everything shared). The moment a
 * user signs in, their data lives under their own userId key and
 * stays isolated even if they sign out and sign in as someone else.
 */
export const ANONYMOUS_USER_ID = 'anonymous';

// ---------------------------------------------------------------------------
// Preferences — local-only user prefs (theme handled separately by
// ThemeProvider; these are read by TranslationStage + landing).
// ---------------------------------------------------------------------------

/** Audio playback rate consumed by TranslationStage's <audio>. */
export const STORAGE_AUDIO_RATE = 'prefs.audioRate';
/** Optional override of catalog.defaults.difficulty for the landing /
 *  practice entry. Empty string means "follow catalog default". */
export const STORAGE_DEFAULT_DIFFICULTY = 'prefs.defaultDifficulty';
/** Whether to show phonetic transcription in TranslationStage's word card. */
export const STORAGE_SHOW_PHONETIC = 'prefs.showPhonetic';

const AUDIO_RATE_VALUES = [0.75, 1, 1.25] as const;
export type AudioRate = (typeof AUDIO_RATE_VALUES)[number];

/** Read a JSON-safe preference value from localStorage. SSR-safe
 *  (returns `fallback` when window is unavailable). */
export function readPrefString(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** Read a boolean preference from localStorage. Strict 'true'/'false'
 *  match only — anything else (including null) returns `fallback`. */
export function readPrefBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* 隐私模式静默 */
  }
  return fallback;
}

/** Read an audio-rate preference. Invalid stored values fall back to 1. */
export function readPrefAudioRate(): AudioRate {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.localStorage.getItem(STORAGE_AUDIO_RATE);
    const n = raw == null ? NaN : Number(raw);
    if (n === 0.75 || n === 1 || n === 1.25) return n;
  } catch {
    /* 隐私模式静默 */
  }
  return 1;
}

/** Write a string preference to localStorage. Silent failure on
 *  private mode. */
export function writePrefString(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式静默 */
  }
}

/** Write a boolean preference to localStorage. */
export function writePrefBool(key: string, value: boolean): void {
  writePrefString(key, String(value));
}

/** Write an audio-rate preference. Caller-side type validation is
 *  recommended (see AUDIO_RATE_VALUES). */
export function writePrefAudioRate(value: AudioRate): void {
  writePrefString(STORAGE_AUDIO_RATE, String(value));
}

/** Drop a preference key entirely. */
export function removePref(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 隐私模式静默 */
  }
}

/**
 * Clear all local data for a user — drill progress + collection +
 * pref keys. Used by SettingsTab's "danger zone" reset.
 *
 * Idempotent — keys that don't exist are silently skipped.
 */
export function clearAllLocalUserData(userId: string): void {
  if (typeof window === 'undefined') return;
  const keys = [
    getTranslationProgressKey(userId),
    getCollectionKey(userId),
    `me.displayNameFallback:${userId}`,
  ];
  for (const k of keys) removePref(k);
  // Notify same-tab listeners (StatsTab / CollectionTab) so the
  // refreshed storage event isn't the only thing that's seen.
  window.dispatchEvent(new CustomEvent('collection-changed', { detail: { clear: true } }));
  window.dispatchEvent(
    new CustomEvent('translation-progress-changed', { detail: { cleared: true } }),
  );
}

/** Per-user localStorage key for the drill progress blob. */
export function getTranslationProgressKey(userId: string): string {
  return `translationProgress:${userId}`;
}

export function loadTranslationProgress(userId: string = ANONYMOUS_USER_ID): TranslationProgress {
  try {
    const raw = window.localStorage.getItem(getTranslationProgressKey(userId));
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

export function saveTranslationProgress(
  progress: TranslationProgress,
  userId: string = ANONYMOUS_USER_ID,
): void {
  try {
    window.localStorage.setItem(
      getTranslationProgressKey(userId),
      JSON.stringify(progress),
    );
  } catch {
    /* 隐私模式静默 */
  }
}

// ---------------------------------------------------------------------------
// Collection — 用户主动收藏 (sentence + word)
//
// Phase X 设计转变:从"自动记录错题"改成"用户主动收藏"。
// Collection 与 drill progress 完全独立 — 一个句子可以"答错但值得收藏",
// 也可以"答对但不想收藏"。drill 数据继续保留供 StatsTab 用(统计),
// 但不再驱动任何 UI 行为。
//
// 存储策略:
//   - 单一 localStorage key (me.collection),JSON 序列化整个对象
//   - 句子的 key = sentence.id (UUID);单词的 key = word 文本小写
//     (因为同一单词在不同 lib 里 id 不同,但作为收藏我们想跨 lib 去重)
//   - 单词 key 用文本而非 id 是有意的:用户对"star 这个词"的认知
//     与具体 lib 无关,跨词库聚合后才像"生词本"该有的样子
// ---------------------------------------------------------------------------

export interface CollectionEntry {
  /** 加入时间戳,排序用 */
  addedAt: number;
  /** 句子来源的 libId(只对 sentences 有意义,words 不存)。用
   *  于 Me 页筛选"按词库" + 课程内跳转。 */
  libId?: string;
}

export interface Collection {
  sentences: Record<string, CollectionEntry>;
  words: Record<string, CollectionEntry>;
}

/** Per-user localStorage key for the collection blob. */
export function getCollectionKey(userId: string): string {
  return `me.collection:${userId}`;
}

const EMPTY_COLLECTION: Collection = { sentences: {}, words: {} };

export function loadCollection(userId: string = ANONYMOUS_USER_ID): Collection {
  if (typeof window === 'undefined') return EMPTY_COLLECTION;
  try {
    const raw = window.localStorage.getItem(getCollectionKey(userId));
    if (!raw) return EMPTY_COLLECTION;
    const parsed = JSON.parse(raw) as Partial<Collection>;
    return {
      sentences: parsed.sentences ?? {},
      words: parsed.words ?? {},
    };
  } catch {
    /* 损坏数据当作空集合 */
    return EMPTY_COLLECTION;
  }
}

export function saveCollection(
  collection: Collection,
  userId: string = ANONYMOUS_USER_ID,
): void {
  try {
    window.localStorage.setItem(getCollectionKey(userId), JSON.stringify(collection));
  } catch {
    /* 隐私模式静默 */
  }
}

/**
 * 收藏一个句子 + 该句对应的单词。一次调用两边都加。
 * 设计取舍:1:1 关系(一个 drill 句子对应一个目标单词),所以
 * 收藏句子和收藏单词原子绑定。要支持单独收藏单词/句子时,
 * 改成两个独立的 API。
 *
 * 重复添加是 no-op(updatedAt 不变);重复移除也是 no-op。
 */
export function addToCollection(
  sentenceId: string,
  word: string,
  userId: string = ANONYMOUS_USER_ID,
  libId?: string,
): Collection {
  const c = loadCollection(userId);
  const now = Date.now();
  // 已存在就不覆盖 addedAt(保留原始收藏时间,排序更稳定)
  if (!c.sentences[sentenceId]) {
    c.sentences[sentenceId] = { addedAt: now, libId };
  }
  const wordKey = word.trim().toLowerCase();
  if (wordKey && !c.words[wordKey]) {
    c.words[wordKey] = { addedAt: now };
  }
  saveCollection(c, userId);
  return c;
}

/**
 * Remove a sentence from the collection. With the current 1:1
 * binding (one drill sentence ↔ one target word), removing the
 * sentence also drops ALL word entries — the words tab and the
 * sentence tab stay in lockstep. If we ever support separate
 * word/sentence collection (granularity split), this helper will
 * need an optional keepWords flag.
 */
export function removeFromCollection(
  sentenceId: string,
  userId: string = ANONYMOUS_USER_ID,
): Collection {
  const c = loadCollection(userId);
  delete c.sentences[sentenceId];
  // Drop every word entry — they were only there because they were
  // bound to a now-removed sentence. Cheap (the words map is tiny)
  // and keeps the 1:1 invariant honest.
  c.words = {};
  saveCollection(c, userId);
  return c;
}

export function isSentenceCollected(
  sentenceId: string,
  userId: string = ANONYMOUS_USER_ID,
): boolean {
  const c = loadCollection(userId);
  return sentenceId in c.sentences;
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
  if (DEMO_MODE) {
    return DEMO_USER;
  }

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
  if (DEMO_MODE) {
    return DEMO_USER;
  }

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
  if (DEMO_MODE) {
    return;
  }

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
  if (DEMO_MODE) {
    return DEMO_USER;
  }

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

/**
 * PATCH /api/auth/me — update the current user's display_name.
 *
 * The backend may not expose this route yet (Phase 4 polish — flag
 * the first time we wire it). The Me page's inline-edit catches the
 * ApiError and falls back to a per-user localStorage cache so the
 * surface still feels responsive. The next server-truth refetch
 * (login or refresh) wins, as it should.
 */
export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  if (DEMO_MODE) {
    return { ...DEMO_USER, display_name: displayName };
  }

  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ display_name: displayName }),
  });
  const body = (await parseOrThrow(res)) as AuthUser;
  return body;
}

// ---------------------------------------------------------------------------
// Dashboard — login-required activity surface
//
// One round-trip (GET /api/dashboard) hydrates the whole page. The
// `ContinueState.session_id` lets the Continue Card resume the user's
// last unfinished session by routing to /practice?session=<id> — see
// the small /practice hook in page.tsx that reads ?session= and
// forwards to the drill.
//
// Field names mirror the backend Pydantic schemas (snake_case) so we
// don't pay an alias layer in either direction.
// ---------------------------------------------------------------------------

export interface DashboardUser {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface ContinueState {
  session_id: string | null;
  lib_id: string | null;
  lesson_index: number | null;
  current_sentence_position: number;
  sentences_attempted: number;
  preview: string;
  is_unfinished: boolean;
}

export interface DailyGoalState {
  target: number;
  today_count: number;
  /** ISO date string (YYYY-MM-DD) from the backend. */
  today_date: string;
  pct: number;
  completed: boolean;
}

export interface StreakInfo {
  current: number;
  longest: number;
  today_done: boolean;
  active_days: string[]; // ISO dates
}

export interface CalendarDay {
  date: string; // ISO date
  sentences_count: number;
  accuracy: number | null;
  goal_hit: boolean;
  is_future: boolean;
  is_streak_node: boolean;
}

export interface MonthlyGoalInfo {
  target: number;
  current: number;
  year_month: string; // "2026-07"
  achieved: boolean;
  on_track: boolean;
}

export interface KpiStat {
  value: number;
  delta: number;
  label: string;
}

export interface DashboardSnapshot {
  user: DashboardUser;
  /** Backend serializes the field as `continue` (a Python keyword
   *  got aliased); we surface it under the same name to avoid a
   *  mapping layer. */
  continue: ContinueState;
  daily_goal: DailyGoalState;
  streak: StreakInfo;
  calendar: CalendarDay[];
  monthly_goal: MonthlyGoalInfo;
  progress: Record<string, KpiStat>;
  generated_at: string;
}

/**
 * GET /api/dashboard — single round-trip the dashboard renders from.
 * Requires auth (the backend returns 401 otherwise). The caller is
 * expected to redirect anonymous users to /login before invoking this.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (DEMO_MODE) {
    return DEMO_DASHBOARD;
  }

  const res = await fetch(`${API_BASE_URL}/api/dashboard`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`获取 dashboard 失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export interface DaySessionSummary {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  sentences_attempted: number;
  sentences_correct: number;
  is_finished: boolean;
}

export interface DayDetail {
  date: string;
  sentences_count: number;
  correct_count: number;
  accuracy: number | null;
  goal_hit: boolean;
  sessions: DaySessionSummary[];
}

/** GET /api/dashboard/day/{date} — drawer payload for a clicked cell. */
export async function getDayDetail(date: string): Promise<DayDetail> {
  if (DEMO_MODE) {
    return {
      date,
      sentences_count: 7,
      correct_count: 5,
      accuracy: 0.71,
      goal_hit: false,
      sessions: [],
    };
  }

  const res = await fetch(`${API_BASE_URL}/api/dashboard/day/${date}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`获取当天详情失败 (HTTP ${res.status})`);
  }
  return res.json();
}

/** POST /api/dashboard/monthly-goal — set the user's monthly target. */
export async function updateMonthlyGoal(target: number): Promise<MonthlyGoalInfo> {
  if (DEMO_MODE) {
    return {
      target,
      current: 187,
      year_month: new Date().toISOString().slice(0, 7),
      achieved: false,
      on_track: true,
    };
  }

  const res = await fetch(`${API_BASE_URL}/api/dashboard/monthly-goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ target }),
  });
  if (!res.ok) {
    throw new Error(`更新月度目标失败 (HTTP ${res.status})`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Practice session — write surface the /practice drill uses.
//
// Called from /practice on each step (best-effort) and once on
// session end (authoritative). The dashboard's Continue Card reads
// back via getDashboardSnapshot() — no separate "active session"
// endpoint needed.
// ---------------------------------------------------------------------------

/**
 * POST /api/practice/session/start — begin a new session.
 *
 * `lib_id` and `lesson_index` are optional — the homepage's free
 * practice mode passes neither; a lib card passes lib_id; the future
 * lesson surface passes both.
 *
 * Returns the new session_id; the drill then loads its sentence
 * pool and starts calling recordPracticeStep().
 */
export async function startPracticeSession(input: {
  lib_id?: string;
  lesson_index?: number;
}): Promise<{ session_id: string }> {
  if (DEMO_MODE) {
    return { session_id: 'demo-session' };
  }

  const res = await fetch(`${API_BASE_URL}/api/practice/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...(input.lib_id ? { lib_id: input.lib_id } : {}),
      ...(input.lesson_index != null ? { lesson_index: input.lesson_index } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`开始练习失败 (HTTP ${res.status})`);
  }
  return res.json();
}

/**
 * POST /api/practice/session/{id}/step — fire-and-forget per-step
 * telemetry. The endpoint returns 204; we treat any non-2xx as a
 * silent failure (the /end call carries the authoritative totals).
 */
export async function recordPracticeStep(
  sessionId: string,
  correct: boolean,
): Promise<void> {
  if (DEMO_MODE) {
    return;
  }

  try {
    await fetch(`${API_BASE_URL}/api/practice/session/${sessionId}/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ correct }),
    });
  } catch {
    // best-effort; the /end call is authoritative
  }
}

/**
 * POST /api/practice/session/{id}/end — close the session and trigger
 * the daily_activity rollup + streak update server-side.
 *
 * `sentences_attempted` / `sentences_correct` are the totals the
 * client has accumulated; the server replaces whatever the /step
 * calls have bumped with these (so a lost step batch doesn't
 * undercount). Returns a small envelope with today_count / target /
 * streak so the dashboard can optimistically update.
 */
export async function endPracticeSession(
  sessionId: string,
  sentencesAttempted: number,
  sentencesCorrect: number,
): Promise<{
  session_id: string;
  is_finished: boolean;
  today_count: number;
  today_target: number;
  today_completed: boolean;
  current_streak: number;
}> {
  if (DEMO_MODE) {
    return {
      session_id: sessionId,
      is_finished: true,
      today_count: sentencesCorrect,
      today_target: 20,
      today_completed: sentencesCorrect >= 20,
      current_streak: 3,
    };
  }

  const res = await fetch(`${API_BASE_URL}/api/practice/session/${sessionId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      sentences_attempted: sentencesAttempted,
      sentences_correct: sentencesCorrect,
    }),
  });
  if (!res.ok) {
    throw new Error(`结束练习失败 (HTTP ${res.status})`);
  }
  return res.json();
}


/**
 * Fetch N random sentences from a vocab lib (typically the first /
 * beginner lib). Used by TypefallDemo in the hero to populate the
 * "中→英" typewriter demo with real curriculum data instead of
 * hardcoded strings. Cached per-lib on the landing page; no polling.
 */
export async function fetchRandomSentences(
  libId: string,
  count: number = 3,
  difficulty: string = 'beginner'
): Promise<LessonSentence[]> {
  if (DEMO_MODE) {
    // 复用 listLessons 里的 DEMO_LESSON_DETAIL.sentences_by_word 第一组,
    // 截取前 count 条作为 demo 数据,确保 DEMO 模式跟真实模式视觉一致。
    const all = Object.values(DEMO_LESSON_DETAIL.sentences_by_word).flat();
    return all.slice(0, count);
  }
  const params = new URLSearchParams({
    lib_id: libId,
    difficulty,
    count: String(count),
  });
  const response = await fetch(
    `${API_BASE_URL}/api/sentences/random?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`拉取 demo 句失败 (HTTP ${response.status})`);
  }
  return response.json();
}
