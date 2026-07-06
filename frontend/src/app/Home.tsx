'use client';

import {
  TranslationProgress,
  VocabularyLib,
} from './api';

/**
 * Lesson size, mirrored from db/content/manifest.yaml's
 * defaults.lesson_size. Kept in sync with the manifest by convention
 * (manifest is the source of truth — this is a UI default). If the
 * manifest's default ever changes, update this constant.
 *
 * Why not fetch from the backend? The backend's CatalogResponse could
 * expose `lesson_size_per_lib`, but the only data we have today is
 * word_count — and the only sane lesson count is ceil(word_count /
 * lesson_size). Adding a per-lib lesson_count API just for this would
 * be overkill; the ceiling formula is fine until per-lib lesson sizes
 * actually diverge.
 */
const DEFAULT_LESSON_SIZE = 5;

export interface HomeProps {
  /** All baked libs, in catalog order (already sorted server-side by level). */
  libs: VocabularyLib[];
  /** Per-lib translation progress blob. */
  translationProgress: TranslationProgress;
  /** Called when the user clicks a lib tile. Parent should navigate to
   *  `/?lib={libId}` so TranslationLessonList renders for that lib. */
  onPickLib: (libId: string) => void;
}

/**
 * Compute the number of translation-completed lessons for a single lib.
 * A lesson is "completed" iff its `completedAt` is set in the progress blob.
 */
function countCompleted(progress: TranslationProgress, libId: string): number {
  const libProgress = progress[libId];
  if (!libProgress) return 0;
  let n = 0;
  for (const lessonIndex in libProgress) {
    if (libProgress[lessonIndex]?.completedAt) n++;
  }
  return n;
}

/**
 * Compute total lesson count from `word_count` using the default lesson
 * size. ceil() handles libs whose word_count is not a multiple of 5.
 */
function totalLessons(wordCount: number): number {
  return Math.ceil(wordCount / DEFAULT_LESSON_SIZE);
}

/**
 * Home — the course picker / library catalog.
 *
 * Renders one card per lib with name + level + word count + optional
 * description + **per-lib translation completion progress**. Click a
 * card to enter TranslationLessonList for that lib.
 *
 * Translation is the only mode — there is no dictation/listening
 * surface. The whole app routes to a translation session once the
 * user picks a lib.
 *
 * Used when:
 *   - The catalog has multiple libs, AND
 *   - The user has no remembered libId in localStorage, AND
 *   - The URL has no `?lib=` param (i.e. truly a fresh landing).
 *
 * Single-lib catalogs skip this screen entirely and go straight to
 * TranslationLessonList (one card is not a picker).
 */
export default function Home({
  libs,
  translationProgress,
  onPickLib,
}: HomeProps) {
  const totalWords = libs.reduce((s, l) => s + l.word_count, 0);
  const totalLessonsAll = libs.reduce(
    (s, l) => s + totalLessons(l.word_count),
    0
  );
  const completedAll = libs.reduce(
    (s, l) => s + countCompleted(translationProgress, l.id),
    0
  );
  const percentAll =
    totalLessonsAll > 0
      ? Math.round((completedAll / totalLessonsAll) * 100)
      : 0;

  return (
    <div className="home">
      <header className="home__header">
        <p className="home__caption">词库目录</p>
        <h1 className="home__title">选择词库</h1>
        <p className="home__meta">
          {libs.length} 个词库 · {totalWords.toLocaleString()} 词 ·{' '}
          {totalLessonsAll} 课
        </p>
        <p className="home__progress">
          已完成 {completedAll} / {totalLessonsAll} 课 · {percentAll}%
        </p>
      </header>

      <ol className="home__tiles" aria-label="词库列表">
        {libs.map((lib) => {
          const completed = countCompleted(translationProgress, lib.id);
          const total = totalLessons(lib.word_count);
          const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
          const hasDescription = Boolean(lib.description);

          return (
            <li key={lib.id} className="home__tile-item">
              <button
                type="button"
                className="home__tile"
                onClick={() => onPickLib(lib.id)}
                aria-label={`${lib.name} · ${lib.word_count} 词 · 已完成 ${percent}%`}
              >
                <div className="home__tile-head">
                  <span className="home__tile-name">{lib.name}</span>
                  <span className="home__tile-level">{lib.level}</span>
                </div>

                {hasDescription && (
                  <p className="home__tile-desc">{lib.description}</p>
                )}

                <dl className="home__tile-stats" aria-label="词库统计">
                  <div className="home__tile-stat">
                    <dt className="home__tile-stat-num">{lib.word_count}</dt>
                    <dd className="home__tile-stat-label">词</dd>
                  </div>
                  <div className="home__tile-stat">
                    <dt className="home__tile-stat-num">{total}</dt>
                    <dd className="home__tile-stat-label">课</dd>
                  </div>
                </dl>

                <div className="home__tile-progress">
                  <div className="home__progress-track">
                    <div
                      className="home__progress-fill"
                      style={{ width: `${percent}%` }}
                      aria-hidden
                    />
                  </div>
                  <p className="home__progress-label">
                    已完成 {completed} / {total} 课 · {percent}%
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
