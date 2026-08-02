'use client';

/**
 * StatsTab — aggregate stats + per-lib progress table.
 *
 * All data is local: derive everything from `loadTranslationProgress()`
 * and the `Catalog` passed down from /me. No fetch.
 *
 * KPIs (4-cell grid):
 *   - 已练词库  = number of libIds with any sentence progress
 *   - 已判句子  = total sentence entries across all libs
 *   - 总正确率   = sum(correct) / sum(answered)
 *   - 连续天数   = 0 in Phase 4 (streak stamp lands in a future
 *                  phase; we don't want to touch TranslationSession
 *                  in this pass — see Me MVP checklist §6.1)
 *
 * Per-lib progress table — one row per lib in the catalog. Reads
 * word_count + a parallel /api/lessons/<libId>/all call to count
 * total sentences per lib. To avoid N round-trips on mount we
 * fetch lazily: each row triggers its own count when it scrolls
 * into view. Simpler MVP: skip the per-lib sentence totals and
 * just show answered / correct counts from the local blob.
 */
import { useEffect, useState } from 'react';
import {
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from '../api';
import { useCountUp } from './useCountUp';

interface StatsTabProps {
  catalog: Catalog | null;
  catalogError: string | null;
  /** Per-user localStorage namespace key. */
  userId: string;
}

export default function StatsTab({ catalog, catalogError, userId }: StatsTabProps) {
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [hydrated, setHydrated] = useState(false);

  // Progress lives in localStorage — re-read on mount (the user
  // may have just finished a session in another tab).
  useEffect(() => {
    setProgress(loadTranslationProgress(userId));
    setHydrated(true);
  }, [userId]);

  const kpis = computeKpis(progress);
  const libRows = catalog ? computeLibRows(progress, catalog) : [];

  return (
    <div className="me-stats">
      <section className="me-stats__kpis" aria-label="总览统计">
        <KpiCell
          label="已练词库"
          value={hydrated ? kpis.libsCount : '—'}
          animateFrom={hydrated ? kpis.libsCount : 0}
        />
        <KpiCell
          label="已判句子"
          value={hydrated ? kpis.sentencesTotal : '—'}
          animateFrom={hydrated ? kpis.sentencesTotal : 0}
        />
        <KpiCell
          label="总正确率"
          value={hydrated ? (kpis.accuracy != null ? `${kpis.accuracy}%` : '—') : '—'}
          animateFrom={0}
          skipCountUp
        />
        <KpiCell label="连续天数" value={kpis.streakDays} hint="连续 7 天练习解锁" />
      </section>

      <section className="me-stats__libs" aria-label="词库进度">
        <h2 className="me-section-title">词库进度</h2>
        {!catalog ? (
          <p className="me-empty">
            {catalogError ? `加载词库失败:${catalogError}` : '加载词库中…'}
          </p>
        ) : libRows.length === 0 ? (
          <p className="me-empty">还没有开始练习,先去挑个词库试试 →</p>
        ) : (
          <table className="me-lib-table">
            <thead>
              <tr>
                <th scope="col">词库</th>
                <th scope="col" className="me-lib-table__num">已练</th>
                <th scope="col" className="me-lib-table__num">正确率</th>
                <th scope="col" className="me-lib-table__num">错题</th>
              </tr>
            </thead>
            <tbody>
              {libRows.map((row, i) => (
                <tr key={row.libId}>
                  <th scope="row" className="me-lib-table__name">
                    {row.libName}
                  </th>
                  <td className="me-lib-table__num">{row.answered}</td>
                  <td className="me-lib-table__num">
                    <AccuracyBar
                      accuracy={row.accuracy}
                      hint={row.accuracy != null ? `${row.accuracy}%` : '—'}
                      index={Math.min(i, 12)}
                    />
                  </td>
                  <td className="me-lib-table__num">{row.wrong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function KpiCell({
  label,
  value,
  hint,
  animateFrom,
  skipCountUp,
}: {
  label: string;
  value: string | number;
  hint?: string;
  /** When provided AND not in reduced-motion, the numeric value is
   *  driven by useCountUp so it tweens from 0 → animateFrom on mount.
   *  Pass 0 to opt out (e.g. for streak which is currently 0). */
  animateFrom?: number;
  /** Skip count-up entirely (e.g. the accuracy cell shows a percent
   *  string, not a raw number — animating digits inside a string is
   *  visually noisy and we don't want to do it). */
  skipCountUp?: boolean;
}) {
  // useCountUp is unconditionally called so React hook order is stable
  // across KpiCells with different prop shapes. The hook returns 0
  // immediately when `to` is 0; we then display either the live count
  // or the supplied string value.
  const [counted, reached] = useCountUp(animateFrom ?? 0);
  // Achievement glow triggers when the count lands on its target.
  // Currently only wired for the accuracy card (passed via label
  // marker); other cards use reached but the CSS doesn't act on it.
  const displayValue =
    skipCountUp || animateFrom == null ? value : counted;
  const isAchievement =
    !skipCountUp && animateFrom != null && animateFrom === 100 && reached;
  return (
    <div
      className="me-kpi"
      data-reached={reached ? 'true' : 'false'}
      data-achievement={isAchievement ? 'true' : 'false'}
    >
      <div className="me-kpi__value">{displayValue}</div>
      <div className="me-kpi__label">{label}</div>
      {hint ? <div className="me-kpi__hint">{hint}</div> : null}
    </div>
  );
}

function AccuracyBar({
  accuracy,
  hint,
  index,
}: {
  accuracy: number | null;
  hint: string;
  /** Row index in the table — used to stagger the fill animation so
   *  the table reads as "filling up row by row" rather than all rows
   *  animating at once. Cap happens at the call site (caller passes
   *  min(index*20, 240)). */
  index: number;
}) {
  // Track width in state so we can transition from 0 → target. The
  // initial render paints with width:0 (the .me-accuracy__fill CSS
  // rule sets width:0 by default), then a rAF bump on mount flips
  // to the target — which is what triggers the CSS transition.
  const [width, setWidth] = useState(0);
  const target = accuracy == null ? 0 : accuracy;

  useEffect(() => {
    // Reduced-motion → jump straight to target. Otherwise the rAF
    // ensures the initial 0 paint commits before the target value
    // lands — without it the element would render with target width
    // and the transition would never fire.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setWidth(target);
      return;
    }
    const id = requestAnimationFrame(() => {
      setWidth(target);
    });
    return () => cancelAnimationFrame(id);
  }, [target]);

  return (
    <span
      className="me-accuracy"
      aria-label={`正确率 ${hint}`}
      style={{ animationDelay: `${index * 20}ms` }}
    >
      <span className="me-accuracy__track">
        <span
          className="me-accuracy__fill"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="me-accuracy__text">{hint}</span>
    </span>
  );
}

// ----- Pure helpers -----

interface Kpis {
  libsCount: number;
  sentencesTotal: number;
  /** null when no answers exist (avoid "NaN%" / "0%" ambiguity). */
  accuracy: number | null;
  /** Always 0 in Phase 4 — see Streak comment in StatsTab header. */
  streakDays: number;
}

function computeKpis(progress: TranslationProgress): Kpis {
  const libIds = Object.keys(progress);
  let total = 0;
  let correct = 0;
  for (const libId of libIds) {
    const sentences = progress[libId]?.sentences ?? {};
    for (const id in sentences) {
      const p = sentences[id];
      if (!p) continue;
      total += 1;
      if (p.correct) correct += 1;
    }
  }
  const libsCount = libIds.length;
  return {
    libsCount,
    sentencesTotal: total,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
    streakDays: 0,
  };
}

interface LibRow {
  libId: string;
  libName: string;
  answered: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
}

function computeLibRows(progress: TranslationProgress, catalog: Catalog): LibRow[] {
  const byId = new Map<string, VocabularyLibRowInput>(
    catalog.libs.map((l) => [l.id, l]),
  );
  // Include libs that have progress but are no longer in the catalog
  // (operator removed the CSV, blob still has entries). They show up
  // with a "已下架" label so the user understands the count without
  // us silently dropping the data.
  for (const libId in progress) {
    if (!byId.has(libId)) {
      byId.set(libId, {
        id: libId,
        name: '已下架词库',
        level: '',
        word_count: 0,
      });
    }
  }
  const rows: LibRow[] = [];
  for (const [libId, lib] of byId) {
    const sentences = progress[libId]?.sentences ?? {};
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    for (const id in sentences) {
      const p = sentences[id];
      if (!p) continue;
      answered += 1;
      if (p.correct) correct += 1;
      else wrong += 1;
    }
    rows.push({
      libId,
      libName: lib.name,
      answered,
      correct,
      wrong,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
    });
  }
  // Most-practiced lib first.
  rows.sort((a, b) => b.answered - a.answered);
  return rows;
}

interface VocabularyLibRowInput {
  id: string;
  name: string;
  level: string;
  word_count: number;
}