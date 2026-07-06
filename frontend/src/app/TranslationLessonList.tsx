'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  getContentCatalog,
  Catalog,
  listLessons,
  loadTranslationProgress,
  TranslationProgress,
  LessonSummary,
  VocabularyLib,
} from './api';

interface TranslationLessonListProps {
  /** Currently selected lib id. */
  selectedLibId: string;
  /** Called when the user picks a lesson to start. */
  onSelectLesson: (lessonIndex: number) => void;
  /** Called when the user picks a different lib from the in-flow switcher. */
  onSwitchLib: (newLibId: string) => void;
}

/**
 * Lesson size, mirrored from db/content/manifest.yaml's defaults.lesson_size.
 * If the manifest default ever changes, update this constant.
 */
const DEFAULT_LESSON_SIZE = 5;

/**
 * Status per lesson:
 *   - "completed": `completedAt` is set (all 5 words had en2zh + zh2en pass).
 *   - "current": the first lesson that is NOT completed (the
 *     default "where do I continue?" anchor).
 *   - "available": any other lesson — unlocked, freeform, ready to drill.
 *
 * "Current" exists as a soft anchor so the windowed view's "next 4"
 * logic has something to point at; it's NOT enforced as a gate.
 */
function computeStatuses(
  lessons: LessonSummary[],
  progress: TranslationProgress,
  libId: string
): Map<number, 'completed' | 'current' | 'available'> {
  const statuses = new Map<number, 'completed' | 'current' | 'available'>();
  const libProg = progress[libId] ?? {};
  let foundCurrent = false;

  for (const lesson of lessons) {
    const lp = libProg[lesson.lesson_index];
    if (lp?.completedAt) {
      statuses.set(lesson.lesson_index, 'completed');
    } else if (!foundCurrent) {
      statuses.set(lesson.lesson_index, 'current');
      foundCurrent = true;
    } else {
      statuses.set(lesson.lesson_index, 'available');
    }
  }
  return statuses;
}

/**
 * Windowing — same strategy as LessonList (current + next 4 + last
 * completed). Translation mode has no lock cascade, so "current" is
 * just a soft anchor for the window, not a gate.
 */
function visibleLessonIndexes(
  lessons: LessonSummary[],
  statuses: Map<number, 'completed' | 'current' | 'available'>
): Set<number> {
  const visible = new Set<number>();
  let lastCompletedIdx: number | null = null;
  let currentIdx: number | null = null;

  for (const lesson of lessons) {
    const status = statuses.get(lesson.lesson_index);
    if (status === 'completed') {
      lastCompletedIdx = lesson.lesson_index;
    } else if (status === 'current' && currentIdx === null) {
      currentIdx = lesson.lesson_index;
      visible.add(currentIdx);
    }
  }

  if (currentIdx !== null) {
    for (const lesson of lessons) {
      if (
        lesson.lesson_index > currentIdx &&
        lesson.lesson_index <= currentIdx + 4
      ) {
        visible.add(lesson.lesson_index);
      }
    }
  }

  if (lastCompletedIdx !== null) visible.add(lastCompletedIdx);
  return visible;
}

/**
 * TranslationLessonList — translation-mode lesson picker.
 *
 * Windowed rows + jumper + in-flow lib switcher. Reads progress from
 * `translationProgress` (the only progress blob). NO lock cascade —
 * every row is clickable. The `current` marker is a soft anchor for the
 * window only.
 */
export default function TranslationLessonList({
  selectedLibId,
  onSelectLesson,
  onSwitchLib,
}: TranslationLessonListProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [error, setError] = useState('');
  const [jumperValue, setJumperValue] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, ls, p] = await Promise.all([
          getContentCatalog(),
          listLessons(selectedLibId),
          Promise.resolve(loadTranslationProgress()),
        ]);
        if (cancelled) return;
        setCatalog(c);
        setLessons(ls);
        setProgress(p);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载课程失败');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLibId]);

  const statuses = useMemo(() => {
    if (!lessons) return new Map();
    return computeStatuses(lessons, progress, selectedLibId);
  }, [lessons, progress, selectedLibId]);

  const visibleIdx = useMemo(() => {
    if (!lessons) return new Set<number>();
    return visibleLessonIndexes(lessons, statuses);
  }, [lessons, statuses]);

  const visibleLessons = useMemo(() => {
    if (!lessons) return [];
    return lessons.filter((l) => visibleIdx.has(l.lesson_index));
  }, [lessons, visibleIdx]);

  if (error) {
    return (
      <div className="translation-list translation-list--error" role="status">
        <p className="translation-list__error-text">{error}</p>
      </div>
    );
  }

  if (!catalog || !lessons) {
    return (
      <div className="translation-list translation-list--loading">
        <div className="translation-list__skeleton" />
        <div className="translation-list__skeleton" />
        <div className="translation-list__skeleton" />
      </div>
    );
  }

  const lib = catalog.libs.find((l) => l.id === selectedLibId);
  const hasMultipleLibs = catalog.libs.length > 1;
  const totalLessons = Math.ceil((lib?.word_count ?? 0) / DEFAULT_LESSON_SIZE);

  const completedCount = (() => {
    const libProgress = progress[selectedLibId];
    if (!libProgress) return 0;
    let n = 0;
    for (const idx in libProgress) {
      if (libProgress[idx]?.completedAt) n++;
    }
    return n;
  })();
  const percent =
    totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  const handleJumperSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumperValue, 10);
    if (isNaN(n)) return;
    const clamped = Math.max(1, Math.min(n, lessons.length));
    setJumperValue(String(clamped));
    onSelectLesson(clamped);
  };

  return (
    <div className="translation-list">
      <header className="translation-list__header">
        <p className="translation-list__caption">翻译练习</p>

        {hasMultipleLibs ? (
          <TranslationLibSwitcher
            current={lib ?? null}
            allLibs={catalog.libs}
            onSwitchLib={onSwitchLib}
          />
        ) : (
          <h1 className="translation-list__title">{lib?.name ?? ''}</h1>
        )}

        <p className="translation-list__meta">
          {lib?.level} · {lessons.length} 课 · {lib?.word_count ?? 0} 词
        </p>
        <p className="translation-list__progress">
          已完成 {completedCount} / {totalLessons} 课 · {percent}%
        </p>
        <p className="translation-list__hint">
          独立进度，不影响听写解锁
        </p>
      </header>

      <ol className="translation-list__items" aria-label="翻译练习课程列表">
        {visibleLessons.map((lesson) => {
          const status = statuses.get(lesson.lesson_index) ?? 'available';
          const lessonProgress = progress[selectedLibId]?.[lesson.lesson_index];
          const wordCount = lessonProgress
            ? Object.values(lessonProgress.words).filter(
                (w) => w.zh2enCorrect
              ).length
            : 0;

          return (
            <li key={lesson.lesson_index} className="translation-list__item">
              <button
                type="button"
                className={
                  'translation-list__row' +
                  (status === 'current' ? ' translation-list__row--current' : '') +
                  (status === 'completed'
                    ? ' translation-list__row--completed'
                    : '')
                }
                onClick={() => onSelectLesson(lesson.lesson_index)}
                aria-label={
                  status === 'completed'
                    ? `Lesson ${lesson.lesson_index} · 已完成翻译`
                    : status === 'current'
                      ? `Lesson ${lesson.lesson_index} · 继续`
                      : `Lesson ${lesson.lesson_index} · 待开始`
                }
              >
                <span className="translation-list__index">
                  {String(lesson.lesson_index).padStart(2, '0')}
                </span>
                <span className="translation-list__text">
                  <span className="translation-list__row-title">
                    Lesson {lesson.lesson_index}
                  </span>
                  <span className="translation-list__row-meta">
                    {status === 'completed'
                      ? `${wordCount}/${lesson.word_count} 词翻译完成`
                      : status === 'current'
                        ? `${wordCount}/${lesson.word_count} 词已翻译`
                        : `${lesson.word_count} 词待翻译`}
                  </span>
                </span>
                <span className="translation-list__glyph" aria-hidden>
                  {status === 'completed' ? '✓' : status === 'current' ? '→' : '○'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {lessons.length > visibleLessons.length && (
        <form className="translation-list__jumper" onSubmit={handleJumperSubmit}>
          <label className="translation-list__jumper-label" htmlFor="translation-jumper">
            跳到第
          </label>
          <input
            id="translation-jumper"
            type="number"
            min={1}
            max={lessons.length}
            value={jumperValue}
            onChange={(e) => setJumperValue(e.target.value)}
            className="translation-list__jumper-input"
            placeholder="N"
          />
          <span className="translation-list__jumper-suffix">课</span>
          <button type="submit" className="translation-list__jumper-submit">
            跳转
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * In-flow lib switcher for translation mode — mirrors LessonList's
 * LibSwitcher visually, scoped to its own CSS prefix to avoid
 * coupling to dictation-mode UI.
 */
function TranslationLibSwitcher({
  current,
  allLibs,
  onSwitchLib,
}: {
  current: VocabularyLib | null;
  allLibs: VocabularyLib[];
  onSwitchLib: (libId: string) => void;
}) {
  if (!current) return null;
  return (
    <details className="translation-lib-switcher">
      <summary className="translation-lib-switcher__summary">
        <span className="translation-lib-switcher__current-name">{current.name}</span>
        <span className="translation-lib-switcher__chevron" aria-hidden>▾</span>
      </summary>
      <ul className="translation-lib-switcher__menu" role="menu">
        {allLibs.map((l) => {
          const isActive = l.id === current.id;
          return (
            <li key={l.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onSwitchLib(l.id)}
                className={
                  'translation-lib-switcher__item' +
                  (isActive ? ' translation-lib-switcher__item--active' : '')
                }
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="translation-lib-switcher__item-name">{l.name}</span>
                <span className="translation-lib-switcher__item-level">{l.level}</span>
                <span className="translation-lib-switcher__item-check" aria-hidden>
                  {isActive ? '✓' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
