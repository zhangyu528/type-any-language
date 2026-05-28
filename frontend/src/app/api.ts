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

export interface GenerateResponse {
  session_id: string;
  sentences: Sentence[];
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
): Promise<GenerateResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sentences/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lib_id: libId,
      count,
      difficulty,
      force_new: false,
    }),
  });
  if (!response.ok) {
    throw new Error('生成句子失败');
  }
  return response.json();
}

export async function checkAnswer(
  sentenceId: string,
  userInput: string
): Promise<{ is_correct: boolean; correct_answer: string }> {
  const response = await fetch(`${API_BASE_URL}/api/sentences/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sentence_id: sentenceId,
      user_input: userInput,
    }),
  });
  if (!response.ok) {
    throw new Error('校验答案失败');
  }
  return response.json();
}

export function getAudioUrl(audioUrl: string): string {
  if (audioUrl.startsWith('http')) {
    return audioUrl;
  }
  return `${API_BASE_URL}${audioUrl}`;
}