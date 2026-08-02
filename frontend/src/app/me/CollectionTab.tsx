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
 * Data flow:
 *   - me.collection.sentences (localStorage) → list of sentence ids
 *   - catalog + per-lib lesson fetches → sentence text (EN + ZH)
 *     + word metadata. Same N round-trip pattern as before; N is
 *     the number of unique libIds in the collection, which stays
 *     small.
 *
 * Sort options:
 *   - 最近收藏 (default, by addedAt desc)
 *   - 按词库 (group by libId)
 *
 * The lib filter chips are kept — they still serve a real purpose
 * when the user has sentences from multiple libs.
 *
 * "练这句" button → router.push(/?lib=X&sentence=Y). Phase 3.1 in
 * TranslationSession handles the deep link.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Catalog,
  Collection,
  getLib,
  LessonSentence,
  loadCollection,
  removeFromCollection,
} from '../api';

interface CollectionTabProps {
  catalog: Catalog | null;
  catalogError: string | null;
  /** Per-user localStorage namespace key. */
  userId: string;
}

type SortKey = 'recent' | 'lib';

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

export default function CollectionTab({ catalog, catalogError, userId }: CollectionTabProps) {
  const router = useRouter();
  const [collection, setCollection] = useState<Collection>({ sentences: {}, words: {} });
  const [hydrated, setHydrated] = useState(false);
  const [lessonsByLib, setLessonsByLib] = useState<
    Record<string, { sentences: Map<string, LessonSentence> } | 'failed' | 'loading'>
  >({});
  const [activeLibs, setActiveLibs] = useState<Set<string> | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  // 1. Read collection on mount + subscribe to changes.
  // The cross-tab `storage` event + the same-tab `collection-changed`
  // event (dispatched from TranslationStage's star button) keep the
  // list in sync. Without this, the user would star a sentence,
  // navigate to /me, and see a stale list.
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
  // The collection entry itself stores libId (set by TranslationStage
  // when starring), but a sentence id alone is enough to look up the
  // lesson — the fetch is per-lib anyway, so we dedupe on libId.
  // Entries without a stored libId (e.g. from older blobs before
  // libId was recorded) fall back to all libs the catalog has, but
  // we filter that down by trying each lib's lesson and seeing if
  // the sentence id exists in its sentence_map.
  const targetLibIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sentenceId in collection.sentences) {
      const entry = collection.sentences[sentenceId];
      if (entry?.libId) {
        ids.add(entry.libId);
      } else if (catalog) {
        // Legacy entry — be safe and fetch every lib so we can
        // resolve the sentence text. N is still small (< 5 in
        // typical setups); if it grows we can defer.
        for (const lib of catalog.libs) ids.add(lib.id);
      }
    }
    return [...ids];
  }, [collection, catalog]);

  // 3. Fetch each lib's lesson (same pattern as the previous wrong-
  // book version). Per-lib state so a failed fetch doesn't block
  // the whole list.
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
          setLessonsByLib((prev) => ({
            ...prev,
            [libId]: { sentences },
          }));
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
      // We need a libId to resolve the sentence. Prefer the stored
      // one; fall back to scanning all loaded lessons for the id.
      let resolvedLibId: string | null = entry.libId ?? null;
      if (!resolvedLibId) {
        for (const libId in lessonsByLib) {
          const lessonEntry = lessonsByLib[libId];
          if (lessonEntry && lessonEntry !== 'loading' && lessonEntry !== 'failed'
              && lessonEntry.sentences.has(sentenceId)) {
            resolvedLibId = libId;
            break;
          }
        }
      }
      if (!resolvedLibId) continue; // can't render without a lib
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
        if (a.libName !== b.libName) return a.libName.localeCompare(b.libName, 'zh-Hans-CN');
        return b.addedAt - a.addedAt;
      });
    }
    return sorted;
  }, [rows, activeLibs, sortKey]);

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

  // Remove a row from the collection. The 1:1 binding means
  // dropping the sentence also clears all word entries — that's
  // intentional, see removeFromCollection's docs in api.ts.
  const onRemove = (row: CollectionRow) => {
    removeFromCollection(row.sentenceId, userId);
  };

  const allLoaded = targetLibIds.every(
    (id) => lessonsByLib[id] && lessonsByLib[id] !== 'loading',
  );

  // ----- Render -----

  if (!hydrated) {
    return <p className="me-empty">加载中…</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="me-wrong-empty">
        <p className="me-wrong-empty__title">还没有收藏</p>
        <p className="me-wrong-empty__hint">
          在练习时看到喜欢的句子或单词,点 ★ 加入收藏 — 之后可以在这里复习。
        </p>
        <button
          type="button"
          className="me-btn me-btn--primary"
          onClick={() => router.push('/')}
        >
          去练习
        </button>
      </div>
    );
  }

  return (
    <div className="me-wrong">
      <header className="me-wrong__header">
        <p className="me-wrong__count">
          收藏夹 · <strong>{filtered.length}</strong> 句
          {filtered.length !== rows.length ? ` (共 ${rows.length})` : ''}
        </p>
        {catalogError ? (
          <p className="me-wrong__warn">词库信息加载失败,部分卡片可能不显示词库名。</p>
        ) : null}
      </header>

      <div className="me-wrong-filters" role="region" aria-label="筛选与排序">
        <div className="me-wrong-filters__libs" role="group" aria-label="按词库筛选">
          {targetLibIds.map((libId) => {
            const name = catalog?.libs.find((l) => l.id === libId)?.name ?? '已下架词库';
            const active = !activeLibs || activeLibs.has(libId);
            return (
              <button
                key={libId}
                type="button"
                className="me-chip"
                data-active={active ? 'true' : 'false'}
                onClick={() => onToggleLib(libId)}
                aria-pressed={active ? 'true' : 'false'}
              >
                {name}
              </button>
            );
          })}
        </div>
        <label className="me-wrong-filters__sort">
          <span className="me-wrong-filters__sort-label">排序</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="me-select"
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

      <ul className="me-wrong-list">
        {filtered.map((row, i) => (
          <li
            key={`${row.libId}:${row.sentenceId}`}
            // Stagger entrance — 30ms per row, capped at 240ms (8 rows)
            // so a long list doesn't make the last card land after a
            // noticeable delay. Beyond the cap, items animate in
            // lockstep.
            style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
          >
            <CollectionCard
              row={row}
              onPractice={onPractice}
              onRemove={onRemove}
            />
          </li>
        ))}
      </ul>

      {!allLoaded ? (
        <p className="me-wrong__loading">正在加载句子内容…</p>
      ) : null}
    </div>
  );
}

function CollectionCard({
  row,
  onPractice,
  onRemove,
}: {
  row: CollectionRow;
  onPractice: (libId: string, sentenceId: string) => void;
  onRemove: (row: CollectionRow) => void;
}) {
  const sentenceReady = row.sentence != null;
  const relativeTime = formatRelative(row.addedAt);
  return (
    <article className="me-wrong-card">
      <div className="me-wrong-card__meta">
        <span className="me-wrong-card__lib">{row.libName}</span>
        <span className="me-wrong-card__stats">
          收藏于 {relativeTime}
        </span>
      </div>
      {sentenceReady ? (
        <>
          <p className="me-wrong-card__en">{row.sentence!.text}</p>
          <p className="me-wrong-card__zh">{row.sentence!.chinese_text}</p>
        </>
      ) : (
        <p className="me-wrong-card__loading">句子内容加载中…</p>
      )}
      <div className="me-wrong-card__actions">
        <button
          type="button"
          className="me-btn me-btn--ghost"
          onClick={() => onRemove(row)}
          aria-label="从收藏移除"
        >
          ☆ 移除
        </button>
        <button
          type="button"
          className="me-btn me-btn--primary"
          onClick={() => onPractice(row.libId, row.sentenceId)}
        >
          练这句
        </button>
      </div>
    </article>
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