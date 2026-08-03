'use client';

/**
 * StatsTab — aggregate stats + per-lib progress table.
 *
 * All data is local + supplemental dashboard fetch:
 *   - Drill progress is local (`loadTranslationProgress()`).
 *   - Streak / daily-goal / monthly-goal come from the dashboard
 *     endpoint (single round-trip on mount). They surface as KPI
 *     cells so the user has a single "overview" surface here; the
 *     dashboard page renders the same numbers richer (calendar +
 *     detail drawer) but if the user only ever visits /me we still
 *     show today's hint.
 *
 * KPIs (5-cell grid on wide screens, 2 cols on narrow):
 *   - 已练词库  = libs with any sentence progress
 *   - 已判句子  = total sentence entries across all libs
 *   - 总正确率   = sum(correct) / sum(answered)
 *   - 今日已练  = from dashboard.daily_goal.today_count (or local
 *                approximation if dashboard fetch failed)
 *   - 连续天数   = from dashboard.streak.current
 *                  (0  with "开始 7 天连击" CTA when not yet started)
 */
import { useEffect, useState } from 'react';
import {
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
  getDashboardSnapshot,
  type DashboardSnapshot,
} from '../api';
import { useCountUp } from './useCountUp';
import styles from '../me/me-page.module.css';

interface StatsTabProps {
  catalog: Catalog | null;
  catalogError: string | null;
  /** Per-user localStorage namespace key. */
  userId: string;
}

export default function StatsTab({ catalog, catalogError, userId }: StatsTabProps) {
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Progress lives in localStorage — re-read on mount (the user
  // may have just finished a session in another tab) and whenever
  // TranslationSession dispatches a progress-changed event.
  useEffect(() => {
    setProgress(loadTranslationProgress(userId));
    setHydrated(true);
    const onProgressChanged = () => {
      setProgress(loadTranslationProgress(userId));
    };
    window.addEventListener('translation-progress-changed', onProgressChanged);
    return () => {
      window.removeEventListener('translation-progress-changed', onProgressChanged);
    };
  }, [userId]);

  // Dashboard snapshot — best-effort fetch on mount. Failure is
  // tolerated: we just show "—" for the streak / today KPIs. The
  // `/dashboard` page renders these numbers richer if the user
  // wants more.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getDashboardSnapshot();
        if (cancelled) return;
        setSnapshot(s);
      } catch (e) {
        if (cancelled) return;
        setSnapshotError(e instanceof Error ? e.message : '加载 dashboard 失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = computeKpis(progress);
  const libRows = catalog ? computeLibRows(progress, catalog) : [];

  // Derived dashboard fields (with safe defaults when missing).
  const todayCount = snapshot?.daily_goal?.today_count ?? null;
  const todayTarget = snapshot?.daily_goal?.target ?? null;
  const streakCurrent = snapshot?.streak?.current ?? 0;
  const streakLongest = snapshot?.streak?.longest ?? 0;

  const todayHint =
    todayCount != null && todayTarget
      ? todayCount >= todayTarget
        ? '今日目标已达成'
        : `今日目标 ${todayCount} / ${todayTarget}`
      : null;

  const streakHint =
    streakCurrent === 0
      ? '开始 7 天连击'
      : streakLongest > streakCurrent
        ? `历史最长 ${streakLongest} 天`
        : `已连续 ${streakCurrent} 天`;

  return (
    <div className={styles['me-stats']}>
      <section className={styles['me-stats__kpis']} aria-label="总览统计">
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
        <KpiCell
          label="今日已练"
          value={todayCount != null ? todayCount : '—'}
          animateFrom={todayCount != null ? todayCount : 0}
          hint={snapshotError ? '需要 dashboard 数据' : todayHint ?? undefined}
        />
        <KpiCell
          label="连续天数"
          value={streakCurrent}
          animateFrom={streakCurrent}
          hint={streakHint}
        />
      </section>

      <section className={styles['me-stats__libs']} aria-label="词库进度">
        <h2 className={styles['me-section-title']}>词库进度</h2>
        {!catalog ? (
          <p className={styles['me-empty']}>
            {catalogError ? `加载词库失败:${catalogError}` : '加载词库中…'}
          </p>
        ) : libRows.length === 0 ? (
          <p className={styles['me-empty']}>
            还没有开始练习,先去挑个词库试试 →
          </p>
        ) : (
          <table className={styles['me-lib-table']}>
            <thead>
              <tr>
                <th scope="col">词库</th>
                <th scope="col" className={styles['me-lib-table__num']}>已练</th>
                <th scope="col" className={styles['me-lib-table__num']}>正确率</th>
                <th scope="col" className={styles['me-lib-table__num']}>错题</th>
              </tr>
            </thead>
            <tbody>
              {libRows.map((row, i) => (
                <tr key={row.libId}>
                  <th scope="row" className={styles['me-lib-table__name']}>
                    {row.libName}
                  </th>
                  <td className={styles['me-lib-table__num']}>{row.answered}</td>
                  <td className={styles['me-lib-table__num']}>
                    <AccuracyBar
                      accuracy={row.accuracy}
                      hint={row.accuracy != null ? `${row.accuracy}%` : '—'}
                      index={Math.min(i, 12)}
                    />
                  </td>
                  <td className={styles['me-lib-table__num']}>{row.wrong}</td>
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
  const displayValue =
    skipCountUp || animateFrom == null ? value : counted;
  const isAchievement =
    !skipCountUp && animateFrom != null && animateFrom === 100 && reached;
  return (
    <div
      className={styles['me-kpi']}
      data-reached={reached ? 'true' : 'false'}
      data-achievement={isAchievement ? 'true' : 'false'}
    >
      <div className={styles['me-kpi__value']}>{displayValue}</div>
      <div className={styles['me-kpi__label']}>{label}</div>
      {hint ? <div className={styles['me-kpi__hint']}>{hint}</div> : null}
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
  const [width, setWidth] = useState(0);
  const target = accuracy == null ? 0 : accuracy;

  useEffect(() => {
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
      className={styles['me-accuracy']}
      aria-label={`正确率 ${hint}`}
      style={{ animationDelay: `${index * 20}ms` }}
    >
      <span className={styles['me-accuracy__track']}>
        <span
          className={styles['me-accuracy__fill']}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={styles['me-accuracy__text']}>{hint}</span>
    </span>
  );
}

// ----- Pure helpers -----

interface Kpis {
  libsCount: number;
  sentencesTotal: number;
  /** null when no answers exist (avoid "NaN%" / "0%" ambiguity). */
  accuracy: number | null;
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
  rows.sort((a, b) => b.answered - a.answered);
  return rows;
}

interface VocabularyLibRowInput {
  id: string;
  name: string;
  level: string;
  word_count: number;
}
