'use client';

import {
  TranslationProgress,
  VocabularyLib,
} from './api';

export interface HomeProps {
  /** All baked libs, in catalog order (already sorted server-side by level). */
  libs: VocabularyLib[];
  /** Per-lib translation progress blob. */
  translationProgress: TranslationProgress;
  /** Called when the user clicks a lib tile. Parent should navigate to
   *  `/?lib={libId}` so TranslationSession starts. */
  onPickLib: (libId: string) => void;
}

/**
 * Home — the course picker / library catalog.
 *
 * Clicking a lib goes straight into a random-step drill in
 * TranslationSession — there is no intermediate lesson list.
 *
 * Each card shows: name + level + description + the per-lib
 * sentence count + the user's translation progress (correct answers
 * vs total baked sentences). Progress is at the SENTENCE granularity
 * (not per-lesson / not per-word), so every correct answer nudges
 * the bar.
 *
 * Used when:
 *   - The catalog has at least one lib, AND
 *   - The URL has no `?lib=` param (i.e. truly a fresh landing).
 */
export default function Home({
  libs,
  translationProgress,
  onPickLib,
}: HomeProps) {
  return (
    <div className="home">
      <header className="home__header">
        <p className="home__caption">词库目录</p>
        <h1 className="home__title">选择词库</h1>
        <p className="home__meta">{libs.length} 个词库</p>
      </header>

      <ol className="home__tiles" aria-label="词库列表">
        {libs.map((lib) => {
          const hasDescription = Boolean(lib.description);

          return (
            <li key={lib.id} className="home__tile-item">
              <button
                type="button"
                className="home__tile"
                onClick={() => onPickLib(lib.id)}
                aria-label={`${lib.name} · ${lib.word_count} 词`}
              >
                <div className="home__tile-head">
                  <span className="home__tile-name">{lib.name}</span>
                  <span className="home__tile-level">{lib.level}</span>
                </div>

                {hasDescription && (
                  <p className="home__tile-desc">{lib.description}</p>
                )}

                <p className="home__tile-meta">
                  {lib.word_count.toLocaleString()} 词
                </p>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}