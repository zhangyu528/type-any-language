'use client';

import { useEffect, useRef, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { readRecentLibId, summarizeProgress, pickCarouselLibs } from './data';
import LibCarousel from './LibCarousel';

interface LibMarketProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

/**
 * LibMarket — the lib discovery section.
 *
 *   ┌─ 顶部横向轮播 (3 张精选) ─┐
 *   ├─ 全部词库网格 (响应式 1-2 列) ┤
 *
 * Each tile in the grid shows the existing Home-style card with
 * two additions:
 *   - a thin progress bar at the bottom (per-lib correct ratio)
 *   - a "最近练习" chip on the tile whose id matches `prefs.libId`
 *
 * Reuses the existing `.home__tile*` styles in globals.css so the
 * visual is consistent with the previous (still-shipped) Home.
 */
export default function LibMarket({
  libs,
  translationProgress,
  onPickLib,
}: LibMarketProps) {
  const carouselPicks = pickCarouselLibs(libs);
  const recentLibId = readRecentLibId();

  // Reveal on scroll, same pattern as DailyPlan.
  const sectionRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="lib-market"
      className="lib-market"
      aria-label="词库市集"
    >
      <header className="section-header">
        <p className="section-header__caption">词库市集</p>
        <h2 className="section-header__title">挑一个词库，开始练。</h2>
        <p className="section-header__hint">
          {libs.length} 个词库，按等级从高到低排序。点开任意一个直接进入练习。
        </p>
      </header>

      {carouselPicks.length > 0 && (
        <div className="lib-market__carousel-wrap">
          <LibCarousel libs={carouselPicks} onPickLib={onPickLib} />
        </div>
      )}

      <ol
        className={
          'lib-market__grid home__tiles' + (inView ? ' lib-market__grid--in' : '')
        }
        aria-label="全部词库"
      >
        {libs.map((lib) => {
          const stat = summarizeProgress(
            translationProgress,
            lib.id,
            lib.word_count
          );
          const isRecent = lib.id === recentLibId;
          return (
            <li key={lib.id} className="home__tile-item">
              <button
                type="button"
                className={
                  'home__tile' +
                  (isRecent ? ' home__tile--recent' : '')
                }
                onClick={() => onPickLib(lib.id)}
                aria-label={`${lib.name} · ${lib.word_count} 词`}
              >
                {isRecent && (
                  <span className="home__tile-chip" aria-label="最近练习">
                    最近练习
                  </span>
                )}
                <div className="home__tile-head">
                  <span className="home__tile-name">{lib.name}</span>
                  <span className="home__tile-level">{lib.level}</span>
                </div>

                {lib.description && (
                  <p className="home__tile-desc">{lib.description}</p>
                )}

                <p className="home__tile-meta">
                  {lib.word_count.toLocaleString()} 词
                  {stat.answered > 0 && (
                    <>
                      {' · '}
                      {stat.correct}/{stat.answered} ({stat.percent}%)
                    </>
                  )}
                </p>

                <div
                  className="home__tile-progress"
                  role="progressbar"
                  aria-valuenow={stat.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    className="home__tile-progress-fill"
                    style={{ width: `${stat.percent}%` }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
