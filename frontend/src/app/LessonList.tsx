'use client';

import { useEffect, useState } from 'react';
import {
  getContentCatalog,
  listLessons,
  loadLessonProgress,
  LessonProgress,
  LessonSummary,
  VocabularyLib,
} from './api';

interface LessonListProps {
  /** Currently selected lib id. */
  selectedLibId: string;
  /** Called when the user picks a lesson to start. */
  onSelectLesson: (lessonIndex: number) => void;
}

/**
 * Compute the status of each lesson from localStorage progress.
 *
 * Rules (PRD v0.4.0+):
 *   - Lesson 1 is always unlocked.
 *   - Lesson N is unlocked iff lesson N-1 is completed.
 *   - A lesson is "completed" when ALL its words have maxStage=2.
 *   - "Current" is the first lesson that is unlocked but not completed.
 *   - Any lesson after "current" is locked.
 *
 * If no progress data exists, lesson 1 is "current" and the rest are
 * "locked" (locked means "must complete previous to unlock" — we still
 * show them, with a lock glyph, so the user can see the roadmap).
 */
function computeStatuses(
  lessons: LessonSummary[],
  progress: LessonProgress,
  libId: string
): Map<number, 'locked' | 'current' | 'completed'> {
  const statuses = new Map<number, 'locked' | 'current' | 'completed'>();
  let foundCurrent = false;

  for (const lesson of lessons) {
    const lessonProgress = progress[libId]?.[lesson.lesson_index];
    const allStage2 =
      lessonProgress &&
      Object.keys(lessonProgress.words).length === lesson.word_count &&
      Object.values(lessonProgress.words).every((w) => w.maxStage >= 2);

    if (allStage2) {
      statuses.set(lesson.lesson_index, 'completed');
    } else if (!foundCurrent) {
      statuses.set(lesson.lesson_index, 'current');
      foundCurrent = true;
    } else {
      statuses.set(lesson.lesson_index, 'locked');
    }
  }
  return statuses;
}

/**
 * LessonList — the home screen.
 *
 * Renders the current lib's full lesson list with status icons. Click
 * a row to enter the lesson session. Status is derived from
 * localStorage (the read-layer backend has no per-user state).
 */
export default function LessonList({
  selectedLibId,
  onSelectLesson,
}: LessonListProps) {
  const [catalog, setCatalog] = useState<{ libs: VocabularyLib[] } | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [progress, setProgress] = useState<LessonProgress>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, ls, p] = await Promise.all([
          getContentCatalog(),
          listLessons(selectedLibId),
          Promise.resolve(loadLessonProgress()),
        ]);
        if (cancelled) return;
        setCatalog({ libs: c.libs });
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

  if (error) {
    return (
      <div className="lesson-list lesson-list--error" role="status">
        <p className="lesson-list__error-text">{error}</p>
      </div>
    );
  }

  if (!catalog || !lessons) {
    return (
      <div className="lesson-list lesson-list--loading">
        <div className="lesson-list__skeleton" />
        <div className="lesson-list__skeleton" />
        <div className="lesson-list__skeleton" />
      </div>
    );
  }

  const lib = catalog.libs.find((l) => l.id === selectedLibId);
  const statuses = computeStatuses(lessons, progress, selectedLibId);

  return (
    <div className="lesson-list">
      <header className="lesson-list__header">
        <p className="lesson-list__caption">课程列表</p>
        <h1 className="lesson-list__title">{lib?.name ?? ''}</h1>
        <p className="lesson-list__meta">
          {lib?.level} · {lessons.length} 课 · {lib?.word_count ?? 0} 词
        </p>
      </header>

      <ol className="lesson-list__items" aria-label="课程列表">
        {lessons.map((lesson) => {
          const status = statuses.get(lesson.lesson_index) ?? 'locked';
          const lessonProgress = progress[selectedLibId]?.[lesson.lesson_index];
          const masteredCount = lessonProgress
            ? Object.values(lessonProgress.words).filter(
                (w) => w.maxStage >= 2
              ).length
            : 0;

          return (
            <li key={lesson.lesson_index} className="lesson-list__item">
              <button
                type="button"
                className={
                  'lesson-list__row' +
                  (status === 'current' ? ' lesson-list__row--current' : '') +
                  (status === 'completed' ? ' lesson-list__row--completed' : '') +
                  (status === 'locked' ? ' lesson-list__row--locked' : '')
                }
                disabled={status === 'locked'}
                onClick={() => onSelectLesson(lesson.lesson_index)}
                aria-label={
                  status === 'completed'
                    ? `Lesson ${lesson.lesson_index} · 已掌握`
                    : status === 'current'
                      ? `Lesson ${lesson.lesson_index} · 当前`
                      : `Lesson ${lesson.lesson_index} · 未解锁`
                }
              >
                <span className="lesson-list__index">
                  {String(lesson.lesson_index).padStart(2, '0')}
                </span>
                <span className="lesson-list__text">
                  <span className="lesson-list__row-title">
                    Lesson {lesson.lesson_index}
                  </span>
                  <span className="lesson-list__row-meta">
                    {status === 'completed'
                      ? `已掌握 ${masteredCount}/${lesson.word_count} 词`
                      : status === 'current'
                        ? `${masteredCount}/${lesson.word_count} 词已听写`
                        : `${lesson.word_count} 词 · 完成后解锁`}
                  </span>
                </span>
                <span className="lesson-list__glyph" aria-hidden>
                  {status === 'completed' ? '✓' : status === 'current' ? '→' : '🔒'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
