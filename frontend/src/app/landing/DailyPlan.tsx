'use client';

import { useEffect, useState, useRef } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import {
  composeLandingData,
  summarizeProgress,
  readRecentLibId,
  countTotalWrong,
} from './data';

interface DailyPlanProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

/**
 * DailyPlan — three-card section under the Hero.
 *
 *   ┌─ 继续上次 ─┬─ 新词速通 ─┬─ 错题回炉 ─┐
 *   │ 词库+进度环 │ 推荐词库   │ 错句数     │
 *   │ "继续"按钮 │ "开始10句"  │ "去回炉"   │
 *
 * Data source: `translationProgress` from localStorage (zero-backend).
 * `prefs.libId` decides which lib to show in card 1.
 *
 * Reveal: each card fades up on entering the viewport, staggered 100ms.
 */
export default function DailyPlan({ libs, translationProgress, onPickLib }: DailyPlanProps) {
  // We re-read prefs.libId on every render so the card reflects the
  // most recent pick without a full re-fetch. SSR-safe: readRecentLibId
  // returns null on the server.
  const recentLibId = readRecentLibId();
  const recentLib = recentLibId ? libs.find((l) => l.id === recentLibId) : null;

  const landing = composeLandingData({
    libs,
    progress: translationProgress,
  });
  const newLib = libs.find((l) => l.id === landing.weekly_plan.new_lib_id);

  const totalWrong = countTotalWrong(translationProgress);

  // Per-card in-view state — staggered fade-up.
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
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // We use a small arbitrary total for the "继续上次" stat since we
  // don't fetch the lib's full sentence count on the landing page —
  // word_count is a reasonable upper bound proxy.
  const recentStat = recentLib
    ? summarizeProgress(translationProgress, recentLib.id, recentLib.word_count)
    : null;

  return (
    <section
      ref={sectionRef}
      id="daily-plan"
      className="daily-plan"
      aria-label="今日计划"
    >
      <header className="section-header">
        <p className="section-header__caption">今日计划</p>
        <h2 className="section-header__title">今天学 10 句就够。</h2>
        <p className="section-header__hint">
          基于你的练习进度，自动搭配今天该做的三件事。
        </p>
      </header>

      <ol className="daily-plan__cards">
        <li
          className={
            'plan-card' +
            (inView ? ' plan-card--in' : '') +
            (recentLib ? '' : ' plan-card--empty')
          }
          style={{ transitionDelay: inView ? '0ms' : '0ms' }}
        >
          <div className="plan-card__head">
            <span className="plan-card__caption">继续上次</span>
            {recentLib && (
              <ProgressRing
                percent={recentStat?.percent ?? 0}
                answered={recentStat?.correct ?? 0}
                total={recentStat?.total ?? 0}
              />
            )}
          </div>

          {recentLib && recentStat ? (
            <>
              <p className="plan-card__title">{recentLib.name}</p>
              <p className="plan-card__meta">
                {recentStat.correct} / {recentStat.answered} 句
              </p>
              <button
                type="button"
                className="plan-card__btn"
                onClick={() => onPickLib(recentLib.id)}
              >
                继续 →
              </button>
            </>
          ) : (
            <>
              <p className="plan-card__title">还没有练习记录</p>
              <p className="plan-card__meta">从下方词库市集挑一个开始</p>
              <button
                type="button"
                className="plan-card__btn"
                onClick={() => {
                  if (typeof document === 'undefined') return;
                  document
                    .getElementById('lib-market')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                去挑一个 →
              </button>
            </>
          )}
        </li>

        <li
          className={'plan-card' + (inView ? ' plan-card--in' : '')}
          style={{ transitionDelay: inView ? '100ms' : '0ms' }}
        >
          <div className="plan-card__head">
            <span className="plan-card__caption">新词速通</span>
          </div>
          {newLib ? (
            <>
              <p className="plan-card__title">{newLib.name}</p>
              <p className="plan-card__meta">
                词库共 {newLib.word_count.toLocaleString()} 词 · 速通 10 句
              </p>
              <button
                type="button"
                className="plan-card__btn"
                onClick={() => onPickLib(newLib.id)}
              >
                开始 10 句 →
              </button>
            </>
          ) : (
            <>
              <p className="plan-card__title">暂无可推荐词库</p>
              <p className="plan-card__meta">检查 cms manifest 与 CSV</p>
            </>
          )}
        </li>

        <li
          className={
            'plan-card' + (inView ? ' plan-card--in' : '') +
            (totalWrong === 0 ? ' plan-card--empty' : '')
          }
          style={{ transitionDelay: inView ? '200ms' : '0ms' }}
        >
          <div className="plan-card__head">
            <span className="plan-card__caption">错题回炉</span>
          </div>
          {totalWrong > 0 ? (
            <>
              <p className="plan-card__title">{totalWrong} 句待重做</p>
              <p className="plan-card__meta">优先重答上周答错的句</p>
              <button
                type="button"
                className="plan-card__btn"
                disabled
                title="错题回炉功能待后端支持"
              >
                即将上线
              </button>
            </>
          ) : (
            <>
              <p className="plan-card__title">本周 0 错题</p>
              <p className="plan-card__meta">继续保持，下一个错句就是进步</p>
            </>
          )}
        </li>
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ProgressRing — small SVG ring, 56px, sage green stroke            */
/* ------------------------------------------------------------------ */

interface ProgressRingProps {
  percent: number;
  answered: number;
  total: number;
}

function ProgressRing({ percent, answered, total }: ProgressRingProps) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;
  return (
    <span className="progress-ring" aria-label={`${percent}% 完成`}>
      <svg viewBox="0 0 56 56" width="56" height="56" role="img">
        <circle
          className="progress-ring__track"
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="3"
        />
        <circle
          className="progress-ring__fill"
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <span className="progress-ring__label">{percent}%</span>
      <span className="progress-ring__sub">
        {answered}/{total}
      </span>
    </span>
  );
}
