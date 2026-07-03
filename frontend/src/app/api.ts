const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Library / catalog
// ---------------------------------------------------------------------------
export interface VocabularyLib {
  id: string;
  name: string;
  level: string;
  word_count: number;
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
// Sentences (kept for backwards compat — DictationStage still uses it
// for the per-sentence audio_url when a lesson returns no beginner
// sentence for a target word)
// ---------------------------------------------------------------------------
export interface Sentence {
  id: string;
  text: string;
  chinese_text: string;
  target_words: string[];
  difficulty: string;
  audio_url: string | null;
  is_cached: boolean;
}

export async function getVocabularyLibs(): Promise<VocabularyLib[]> {
  const response = await fetch(`${API_BASE_URL}/api/vocabulary/libs`);
  if (!response.ok) {
    throw new Error('获取词库列表失败');
  }
  return response.json();
}

export async function generateSentences(
  libId: string,
  count: number = 10
): Promise<Sentence[]> {
  // Read-layer backend serves pre-baked sentences via GET. Kept around
  // for fallback / debug; the lesson flow uses the lessons endpoint
  // (see listLessons + getLesson below).
  const params = new URLSearchParams({
    lib_id: libId,
    count: String(count),
  });
  const response = await fetch(`${API_BASE_URL}/api/sentences/random?${params}`);
  if (!response.ok) {
    throw new Error('生成句子失败');
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Lessons — Target-Word Lesson feature (PRD v0.4.0+)
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

export async function getLesson(
  libId: string,
  lessonIndex: number
): Promise<LessonDetail> {
  const response = await fetch(
    `${API_BASE_URL}/api/lessons/${libId}/${lessonIndex}`
  );
  if (!response.ok) {
    throw new Error('获取课程详情失败');
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
// Lesson progress (localStorage)
//
// All cross-session state for the lesson feature lives here. Shape:
//   lessonProgress: {
//     [libId]: {
//       [lessonIndex]: {
//         words: { [word]: { maxStage: 1|2; completedAt?: number } };
//         completedAt?: number;  // when all words reached maxStage=2
//       };
//     };
//   }
//
// Privacy-mode failure is silently swallowed (matches the existing
// prefs.libId / prefs.autoPlay pattern in page.tsx).
// ---------------------------------------------------------------------------
export type LessonWordProgress = {
  maxStage: 1 | 2;
  completedAt?: number;
};

export type LessonProgress = {
  [libId: string]: {
    [lessonIndex: number]: {
      words: { [word: string]: LessonWordProgress };
      completedAt?: number;
    };
  };
};

const LESSON_PROGRESS_KEY = 'lessonProgress';

export function loadLessonProgress(): LessonProgress {
  try {
    const raw = window.localStorage.getItem(LESSON_PROGRESS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LessonProgress;
  } catch {
    return {};
  }
}

export function saveLessonProgress(progress: LessonProgress): void {
  try {
    window.localStorage.setItem(LESSON_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* 隐私模式静默 */
  }
}
