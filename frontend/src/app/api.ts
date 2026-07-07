// ---------------------------------------------------------------------------
// API error normalization
//
// Backend error bodies fall into two shapes:
//   - HTTPException: {"detail": "<string>"}            (4xx most cases)
//   - Pydantic 422:  {"detail": [{"loc": [...], "msg": "...", ...}]}
//
// We want to surface a useful message no matter which shape comes back.
// Strategy: if detail is an array, take the first msg; if string, use as-is;
// otherwise fall back to a generic message. Plus we keep the raw status
// for the caller if it wants to switch on 401/409/etc.
// ---------------------------------------------------------------------------
export interface ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string>;
}

export async function readApiError(r: Response, fallback: string): Promise<ApiError> {
  let detail: string | undefined;
  let fieldErrors: Record<string, string> | undefined;

  try {
    const body = await r.json();
    if (body) {
      if (typeof body.detail === 'string') {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // Pydantic validation error: array of {loc, msg, type}.
        // Convert to field-keyed map: loc=["body","email"] → "email".
        const msgs: string[] = [];
        for (const item of body.detail) {
          if (item && typeof item.msg === 'string') {
            const loc = Array.isArray(item.loc) ? item.loc.slice(1) : [];
            const field = loc[0];
            if (field && typeof field === 'string') {
              fieldErrors = fieldErrors ?? {};
              fieldErrors[field] = item.msg;
            }
            msgs.push(item.msg);
          }
        }
        detail = msgs.join('; ') || undefined;
      }
    }
  } catch {
    /* not JSON */
  }

  const err = new Error(detail ?? fallback) as ApiError;
  err.status = r.status;
  if (fieldErrors) err.fieldErrors = fieldErrors;
  return err;
}

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

// ---------------------------------------------------------------------------
// _fetch — wrapper that sends cookies on every request. Required so the
// backend's `tal_session` httpOnly cookie is included on cross-origin
// calls (frontend dev runs on :3000, backend on :8000). Practice-page
// fetches pick up `credentials: 'include'` automatically; protected
// routes (signup/login/me/history) rely on it for auth.
// ---------------------------------------------------------------------------
const _fetch = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { credentials: 'include', ...init });

export async function getContentCatalog(): Promise<Catalog> {
  const response = await _fetch(`${API_BASE_URL}/api/content/catalog`);
  if (!response.ok) {
    throw new Error('获取内容目录失败');
  }
  return response.json();
}

export async function getVocabularyLibs(): Promise<VocabularyLib[]> {
  const response = await _fetch(`${API_BASE_URL}/api/vocabulary/libs`);
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
  const response = await _fetch(`${API_BASE_URL}/api/sentences/random?${params}`);
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
  const response = await _fetch(`${API_BASE_URL}/api/vocabulary/phonetics?${params}`);
  if (!response.ok) {
    throw new Error('查询音标失败');
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// v1 auth — typed wrappers around /api/auth/*.
// The browser auto-sends the httpOnly `tal_session` cookie via
// `credentials: 'include'` in `_fetch`; the JSON `token` field is
// returned for non-browser clients (curl, mobile, future tools) and
// can be ignored by the SPA.
// ---------------------------------------------------------------------------
export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: string | null;
  tier: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  expires_in: number;
}

export interface HistoryResponse {
  items: unknown[];
  user: AuthUser;
}

export async function apiSignup(payload: {
  email: string;
  password: string;
  display_name: string;
}): Promise<AuthResponse> {
  const r = await _fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw await readApiError(r, '注册失败');
  return r.json();
}

export async function apiLogin(payload: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const r = await _fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw await readApiError(r, '登录失败');
  return r.json();
}

export async function apiLogout(): Promise<void> {
  await _fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });
  // 204 No Content — no body to parse. Always treat as success.
}

export async function apiMe(): Promise<AuthUser | null> {
  const r = await _fetch(`${API_BASE_URL}/api/auth/me`);
  if (r.status === 401) return null;
  if (!r.ok) throw await readApiError(r, '获取用户信息失败');
  return r.json();
}

export async function apiHistory(): Promise<HistoryResponse> {
  const r = await _fetch(`${API_BASE_URL}/api/history`);
  if (!r.ok) throw await readApiError(r, '获取历史失败');
  return r.json();
}