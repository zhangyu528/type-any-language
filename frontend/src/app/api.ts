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
// Translation progress (Standalone Translation Drill mode)
//
// Independent localStorage key — the only progress blob the app writes.
// A lesson is "completed" (completedAt set) when every word has both
// en2zhCorrect AND zh2enCorrect true.
// ---------------------------------------------------------------------------
export type TranslationWordProgress = {
  /** 该词的 EN→ZH 翻译步骤是否通过 */
  en2zhCorrect: boolean;
  /** 该词的 ZH→EN 翻译步骤是否通过 */
  zh2enCorrect: boolean;
};

export type TranslationLessonProgress = {
  /** key: lowercase target word. May be missing for words skipped due to
   *  missing sentences / missing chinese_text. */
  words: Record<string, TranslationWordProgress>;
  /** ms epoch; set only when every word in the lesson is fully complete. */
  completedAt?: number;
};

export type TranslationProgress = {
  [libId: string]: {
    [lessonIndex: number]: TranslationLessonProgress;
  };
};

const TRANSLATION_PROGRESS_KEY = 'translationProgress';

export function loadTranslationProgress(): TranslationProgress {
  try {
    const raw = window.localStorage.getItem(TRANSLATION_PROGRESS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TranslationProgress;
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
