const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface VocabularyLib {
  id: string;
  name: string;
  level: string;
  word_count: number;
}

export interface Sentence {
  id: string;
  text: string;
  chinese_text: string;
  target_words: string[];
  difficulty: string;
  audio_url: string | null;
  is_cached: boolean;
}

// Content catalog — powers the LibraryPicker. Returns every lib, each
// lib's available difficulty buckets, and the UI defaults (used when
// the user has no prior selection in localStorage).
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

export async function getVocabularyLibs(): Promise<VocabularyLib[]> {
  const response = await fetch(`${API_BASE_URL}/api/vocabulary/libs`);
  if (!response.ok) {
    throw new Error('获取词库列表失败');
  }
  return response.json();
}

export async function generateSentences(
  libId: string,
  count: number = 10,
  difficulty: string = 'beginner'
): Promise<Sentence[]> {
  // Read-layer backend (commit f26265d "strip to read-layer") serves
  // pre-baked sentences via GET. No session, no cache-miss flow —
  // sentences come straight from the content baked into the db image.
  const params = new URLSearchParams({
    lib_id: libId,
    count: String(count),
    difficulty,
  });
  const response = await fetch(`${API_BASE_URL}/api/sentences/random?${params}`);
  if (!response.ok) {
    throw new Error('生成句子失败');
  }
  return response.json();
}

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