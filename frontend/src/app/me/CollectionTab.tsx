'use client';

/**
 * CollectionTab — list of sentences the user has favorited.
 *
 * Phase X redesign: this used to be the wrong-book tab (auto-
 * collected failed sentences). The product direction shifted to
 * user-driven curation: the user stars sentences/words they want
 * to remember, and we render them here. Drill progress (correct /
 * wrongCount / lastWrongAt) is still kept in localStorage for
 * StatsTab but no longer drives this UI.
 *
 * Two views (segmented switch):
 *   - 句子 (default): familiar sentence cards with audio + remove
 *   - 单词: per-word chips, since `me.collection.words` is a flat
 *     map keyed by lowercase word text. Each chip is rendered as a
 *     small pill — clicked chip removes the word (and because of
 *     the 1:1 binding, all bound sentences get cleared as well).
 *
 * Both views share the same filter chips (per-lib multi-select)
 * and sort selector.
 *
 * "练这句" button → router.push(/?lib=X&sentence=Y). The drill
 * (TranslationSession) reads ?sentence= and lands on that exact
 * step in Phase 3.1.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Catalog,
  Collection,
  getAudioUrl,
  getLib,
  LessonSentence,
  loadCollection,
  readPrefAudioRate,
  removeFromCollection,
} from '../api';
import styles from '../me/me-page.module.css';

interface CollectionTabProps {
  catalog: Catalog | null;
  catalogError: string | null;
  /** Per-user localStorage namespace key. */
  userId: string;
}

type SortKey = 'recent' | 'lib';
type ViewKey = 'sentences' | 'words';

/**
 * A single collection row. Carries everything the card needs to
 * render without re-querying collection state.
 */
interface CollectionRow {
  libId: string;
  libName: string;
  sentenceId: string;
  sentence: LessonSentence | null; // null = lesson fetch failed / stale id
  addedAt: number;
}

const SORT_LABEL: Record<SortKey, string> = {
  recent: '最近收藏',
  lib: '按词库',
};

export default function CollectionTab({
  catalog,
  catalogError,
  userId,
}: CollectionTabProps) {
  const router = useRouter();
  const [collection, setCollection] = useState<Collection>({
    sentences: {},
    words: {},
  });
  const [hydrated, setHydrated] = useState(false);
  const [lessonsByLib, setLessonsByLib] = useState<
    Record<string, { sentences: Map<string, LessonSentence> } | 'failed' | 'loading'>
  >({});
  const [activeLibs, setActiveLibs] = useState<Set<string> | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewKey>('sentences');
  const [audioRate, setAudioRate] = useState(1);

  // Read audio-rate preference on mount. The Stage <audio> reads the
  // same key, but here we want the per-card mini play button to play
  // at the user's chosen speed without waiting for TranslationStage
  // to mount. SSR-safe — defaults to 1.
  useEffect(() => {
    setAudioRate(readPrefAudioRate());
    // Re-read when the user changes the speed on /me. The storage
    // event covers cross-tab; we use the same event listener
    // pattern for symmetry with how the rest of the app stays
    // in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'prefs.audioRate') {
        setAudioRate(readPrefAudioRate());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 1. Read collection on mount + subscribe to changes.
  useEffect(() => {
    setCollection(loadCollection(userId));
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      const expectedKey = `me.collection:${userId}`;
      if (e.key === null || e.key === expectedKey) {
        setCollection(loadCollection(userId));
      }
    };
    const onCollectionChanged = () => setCollection(loadCollection(userId));
    window.addEventListener('storage', onStorage);
    window.addEventListener('collection-changed', onCollectionChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('collection-changed', onCollectionChanged);
    };
  }, [userId]);

  // 2. Resolve the libIds we need to fetch lessons for.
  const targetLibIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sentenceId in collection.sentences) {
      const entry = collection.sentences[sentenceId];
      if (entry?.libId) {
        ids.add(entry.libId);
      } else if (catalog) {
        for (const lib of catalog.libs) ids.add(lib.id);
      }
    }
    return [...ids];
  }, [collection, catalog]);

  // 3. Fetch each lib's lesson (per-lib state so a failed fetch
  // doesn't block the whole list).
  useEffect(() => {
    if (targetLibIds.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const libId of targetLibIds) {
        if (lessonsByLib[libId]) continue;
        setLessonsByLib((prev) => ({ ...prev, [libId]: 'loading' }));
        try {
          const lesson = await getLib(libId);
          if (cancelled) return;
          const sentences = new Map<string, LessonSentence>();
          for (const w of lesson.words) {
            const arr = lesson.sentences_by_word[w.word.toLowerCase()] ?? [];
            for (const s of arr) sentences.set(s.id, s);
          }
          setLessonsByLib((prev) => ({ ...prev, [libId]: { sentences } }));
        } catch {
          if (cancelled) return;
          setLessonsByLib((prev) => ({ ...prev, [libId]: 'failed' }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // lessonsByLib intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLibIds.join('|')]);

  // 4. Build the flat collection-row list.
  const rows = useMemo<CollectionRow[]>(() => {
    const out: CollectionRow[] = [];
    for (const sentenceId in collection.sentences) {
      const entry = collection.sentences[sentenceId];
      if (!entry) continue;
      let resolvedLibId: string | null = entry.libId ?? null;
      if (!resolvedLibId) {
        for (const libId in lessonsByLib) {
          const lessonEntry = lessonsByLib[libId];
          if (
            lessonEntry &&
            lessonEntry !== 'loading' &&
            lessonEntry !== 'failed' &&
            lessonEntry.sentences.has(sentenceId)
          ) {
            resolvedLibId = libId;
            break;
          }
        }
      }
      if (!resolvedLibId) continue;
      const lessonEntry = lessonsByLib[resolvedLibId];
      const sentenceMap =
        lessonEntry && lessonEntry !== 'loading' && lessonEntry !== 'failed'
          ? lessonEntry.sentences
          : null;
      const libName =
        catalog?.libs.find((l) => l.id === resolvedLibId)?.name ?? '已下架词库';
      out.push({
        libId: resolvedLibId,
        libName,
        sentenceId,
        sentence: sentenceMap?.get(sentenceId) ?? null,
        addedAt: entry.addedAt,
      });
    }
    return out;
  }, [collection, lessonsByLib, catalog]);

  // 5. Apply filter + sort.
  const filtered = useMemo(() => {
    const filteredRows = activeLibs
      ? rows.filter((r) => activeLibs.has(r.libId))
      : rows;
    const sorted = [...filteredRows];
    if (sortKey === 'recent') {
      sorted.sort((a, b) => b.addedAt - a.addedAt);
    } else {
      sorted.sort((a, b) => {
        if (a.libName !== b.libName)
          return a.libName.localeCompare(b.libName, 'zh-Hans-CN');
        return b.addedAt - a.addedAt;
      });
    }
    return sorted;
  }, [rows, activeLibs, sortKey]);

  // Word view: each entry from `collection.words` shown as a chip.
  // Sorted by addedAt desc to match the sentence view's default.
  const wordRows = useMemo(() => {
    const out: { word: string; addedAt: number }[] = [];
    for (const word in collection.words) {
      const e = collection.words[word];
      if (!e) continue;
      out.push({ word, addedAt: e.addedAt });
    }
    out.sort((a, b) => b.addedAt - a.addedAt);
    return out;
  }, [collection]);

  const onToggleLib = (libId: string) => {
    setActiveLibs((prev) => {
      const base = prev ?? new Set(targetLibIds);
      const next = new Set(base);
      if (next.has(libId)) next.delete(libId);
      else next.add(libId);
      if (next.size === targetLibIds.length) return null;
      if (next.size === 0) return null;
      return next;
    });
  };

  const onPractice = (libId: string, sentenceId: string) => {
    router.push(`/?lib=${encodeURIComponent(libId)}&sentence=${encodeURIComponent(sentenceId)}`);
  };

  // Remove a sentence from the collection.
  const onRemoveSentence = (row: CollectionRow) => {
    removeFromCollection(row.sentenceId, userId);
  };

  // Remove a single word. Because the binding is 1:1, removing the
  // word nukes the entire word map (matches removeFromCollection's
  // "drop all words when removing any sentence" semantic).
  const onRemoveWord = (word: string) => {
    if (typeof window === 'undefined') return;
    try {
      const key = `me.collection:${userId}`;
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const c = JSON.parse(raw) as Collection;
      delete c.words[word.toLowerCase()];
      window.localStorage.setItem(key, JSON.stringify(c));
      window.dispatchEvent(
        new CustomEvent('collection-changed', { detail: { word } }),
      );
    } catch {
      /* 静默 */
    }
  };

  const allLoaded = targetLibIds.every(
    (id) => lessonsByLib[id] && lessonsByLib[id] !== 'loading',
  );

  const sentenceCount = Object.keys(collection.sentences).length;
  const wordCount = Object.keys(collection.words).length;

  // ----- Render -----

  if (!hydrated) {
    return <p className={styles['me-empty']}>加载中…</p>;
  }

  if (sentenceCount === 0 && wordCount === 0) {
    return (
      <div className={styles['me-wrong-empty']}>
        <p className={styles['me-wrong-empty__title']}>还没有收藏</p>
        <p className={styles['me-wrong-empty__hint']}>
          在练习时看到喜欢的句子或单词,点 ★ 加入收藏 — 之后可以在这里复习。
        </p>
        <button
          type="button"
          className={`${styles['me-btn']} ${styles['me-btn--primary']}`}
          onClick={() => router.push('/')}
        >
          去练习
        </button>
      </div>
    );
  }

  return (
    <div className={styles['me-wrong']}>
      <header className={styles['me-wrong__header']}>
        <p className={styles['me-wrong__count']}>
          收藏夹 ·
          {view === 'sentences' ? (
            <>
              <strong> {filtered.length}</strong> 句
              {filtered.length !== rows.length ? ` (共 ${rows.length})` : ''}
            </>
          ) : (
            <>
              <strong> {wordRows.length}</strong> 词
            </>
          )}
        </p>
        <SegmentedControl
          value={view}
          options={[
            { value: 'sentences', label: '句子' },
            { value: 'words', label: '单词' },
          ]}
          onChange={(v) => setView(v)}
        />
      </header>

      {catalogError ? (
        <p className={styles['me-wrong__warn']}>
          词库信息加载失败,部分卡片可能不显示词库名。
        </p>
      ) : null}

      {view === 'sentences' && targetLibIds.length > 0 ? (
        <div className={styles['me-wrong-filters']} role="region" aria-label="筛选与排序">
          <div className={styles['me-wrong-filters__libs']} role="group" aria-label="按词库筛选">
            {targetLibIds.map((libId) => {
              const name = catalog?.libs.find((l) => l.id === libId)?.name ?? '已下架词库';
              const active = !activeLibs || activeLibs.has(libId);
              return (
                <button
                  key={libId}
                  type="button"
                  className={styles['me-chip']}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => onToggleLib(libId)}
                  aria-pressed={active ? 'true' : 'false'}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <label className={styles['me-wrong-filters__sort']}>
            <span className={styles['me-wrong-filters__sort-label']}>排序</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className={styles['me-select']}
              aria-label="排序方式"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {view === 'sentences' ? (
        <>
          <ul className={styles['me-wrong-list']}>
            {filtered.map((row, i) => (
              <li
                key={`${row.libId}:${row.sentenceId}`}
                style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
              >
                <CollectionCard
                  row={row}
                  audioRate={audioRate}
                  onPractice={onPractice}
                  onRemove={onRemoveSentence}
                />
              </li>
            ))}
          </ul>
          {!allLoaded ? (
            <p className={styles['me-wrong__loading']}>正在加载句子内容…</p>
          ) : null}
        </>
      ) : (
        <div className={styles['me-wrong-filters__libs']} role="list" aria-label="收藏的单词">
          {wordRows.length === 0 ? (
            <p className={styles['me-empty']}>还没有收藏的单词</p>
          ) : (
            wordRows.map(({ word, addedAt }) => (
              <button
                key={word}
                type="button"
                className={styles['me-chip']}
                data-active="true"
                onClick={() => onRemoveWord(word)}
                title={`点击移除 · 收藏于 ${formatRelative(addedAt)}`}
              >
                {word}
                <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 400 }}>
                  ×
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CollectionCard({
  row,
  audioRate,
  onPractice,
  onRemove,
}: {
  row: CollectionRow;
  audioRate: number;
  onPractice: (libId: string, sentenceId: string) => void;
  onRemove: (row: CollectionRow) => void;
}) {
  const sentenceReady = row.sentence != null;
  const relativeTime = formatRelative(row.addedAt);
  return (
    <article className={styles['me-wrong-card']}>
      <div className={styles['me-wrong-card__meta']}>
        <span className={styles['me-wrong-card__lib']}>{row.libName}</span>
        <span className={styles['me-wrong-card__stats']}>
          收藏于 {relativeTime}
        </span>
      </div>
      {sentenceReady ? (
        <>
          <p className={styles['me-wrong-card__en']}>{row.sentence!.text}</p>
          <p className={styles['me-wrong-card__zh']}>
            {row.sentence!.chinese_text}
          </p>
        </>
      ) : (
        <p className={styles['me-wrong-card__loading']}>句子内容加载中…</p>
      )}
      <div className={styles['me-wrong-card__actions']}>
        {sentenceReady && row.sentence!.audio_url ? (
          <InlineAudioButton
            sentence={row.sentence!}
            audioRate={audioRate}
          />
        ) : null}
        <button
          type="button"
          className={`${styles['me-btn']} ${styles['me-btn--ghost']}`}
          onClick={() => onRemove(row)}
          aria-label="从收藏移除"
        >
          ☆ 移除
        </button>
        <button
          type="button"
          className={`${styles['me-btn']} ${styles['me-btn--primary']}`}
          onClick={() => onPractice(row.libId, row.sentenceId)}
        >
          练这句
        </button>
      </div>
    </article>
  );
}

/**
 * Tiny one-shot audio button. Creates an <audio> on demand, plays
 * the sentence at the user's preferred rate, then releases. We
 * don't share with TranslationStage's player because /me is
 * mounted at a different lifecycle point.
 */
function InlineAudioButton({
  sentence,
  audioRate,
}: {
  sentence: LessonSentence;
  audioRate: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Ensure the audio element exists, but only on first click.
  const ensureAudio = (): HTMLAudioElement | null => {
    if (audioRef.current) return audioRef.current;
    if (typeof document === 'undefined') return null;
    const el = new Audio();
    el.preload = 'none';
    audioRef.current = el;
    el.addEventListener('ended', () => setPlaying(false));
    el.addEventListener('pause', () => setPlaying(false));
    return el;
  };

  // Update the playback rate whenever the user changes their
  // preference — even mid-playback.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = audioRate;
    }
  }, [audioRate]);

  const onClick = () => {
    if (!sentence.audio_url) return;
    const el = ensureAudio();
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.src = getAudioUrl(sentence.audio_url);
    el.playbackRate = audioRate;
    el.currentTime = 0;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  return (
    <button
      type="button"
      className={styles['me-wrong-card__audio-btn']}
      onClick={onClick}
      aria-label={playing ? '暂停音频' : '播放音频'}
      title={playing ? '暂停' : `播放 (${audioRate}×)`}
    >
      {playing ? '⏸' : '🔊'}
    </button>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles['me-segmented']} role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={styles['me-segmented__btn']}
          data-active={value === opt.value ? 'true' : 'false'}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value ? 'true' : 'false'}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "2 小时前" / "昨天" / "3 天前" / "2026-07-12". Beyond ~7 days
 * we drop to absolute date — relative time stops being useful.
 */
function formatRelative(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
