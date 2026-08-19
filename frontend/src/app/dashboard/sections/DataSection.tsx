'use client';

/**
 * DataSection — the "数据" partition, redesigned as an Analytics Cockpit.
 *
 *   CommandBar (range + metric)  →  KPI strip  →  trend + (heatmap / goal rings)
 *   → insights  →  weak-points diagnosis + distribution  →  lib progress
 *
 * Data sources (reused from the existing contract):
 *   - GET /api/dashboard/calendar?days=N  → range window (split into current/
 *     previous halves for period comparison) + a fixed heatmap window.
 *   - GET /api/weakness                    → weak points + CEFR/topic distribution
 *     (fetched ONCE here and shared with WeakPointsSection + DistributionPanel).
 *   - snapshot.streak / daily_goal / lifetime → rings + streak insights.
 *
 * The whole section is still lazy-loaded by page.tsx (dynamic, ssr:false).
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  CalendarDay,
  DashboardSnapshot,
  WeaknessPayload,
  apiGetCalendar,
  apiGetWeakness,
} from '../../api';
import { RangeKey, MetricKey } from '../analytics.types';
import DataCommandBar from '../DataCommandBar';
import KpiStrip, { KpiItem } from '../KpiStrip';
import TrendChart from '../TrendChart';
import HeatmapPanel from '../HeatmapPanel';
import GoalRings from '../GoalRings';
import InsightsRow from '../InsightsRow';
import DistributionPanel from '../DistributionPanel';
import WeakPointsSection from './WeakPointsSection';
import LearnedLibProgress from '../LearnedLibProgress';
import DayDetailDrawer from '../DayDetailDrawer';
import LoadingMark from '../../components/LoadingMark';
import card from '../card.module.css';
import styles from './DataSection.module.css';

// How many days to fetch for each range: 2× the visible window so we can
// split into current (last half) + previous (first half) for comparison.
const FETCH_DAYS: Record<RangeKey, number> = { '7': 14, '30': 60, '90': 180, all: 180 };
const HEAT_DAYS = 126; // 18 weeks

interface DataSectionProps {
  snapshot: DashboardSnapshot;
  /** Jump to a lib's practice (weak-point "去练习" CTA). */
  onStartLib: (libId: string) => void;
}

function sumSent(days: CalendarDay[]): number {
  return days.reduce((a, d) => a + (d.sentences_count || 0), 0);
}
function avgAcc(days: CalendarDay[]): number | null {
  const ds = days.filter((d) => d.accuracy != null);
  if (!ds.length) return null;
  return ds.reduce((a, d) => a + (d.accuracy as number), 0) / ds.length;
}
function activeDays(days: CalendarDay[]): number {
  return days.filter((d) => d.sentences_count > 0).length;
}

export default function DataSection({ snapshot, onStartLib }: DataSectionProps) {
  const [range, setRange] = useState<RangeKey>('30');
  const [metric, setMetric] = useState<MetricKey>('sentences');
  const [calRange, setCalRange] = useState<CalendarDay[] | null>(null);
  const [calHeat, setCalHeat] = useState<CalendarDay[] | null>(null);
  const [weakness, setWeakness] = useState<WeaknessPayload | null>(null);
  const [weakError, setWeakError] = useState<string | null>(null);
  const [drawerDate, setDrawerDate] = useState<string | null>(null);

  // Fixed heatmap window (independent of the range selector).
  useEffect(() => {
    let cancelled = false;
    apiGetCalendar(HEAT_DAYS)
      .then((d) => !cancelled && setCalHeat(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Range window for trend + KPIs (refetched on range change).
  useEffect(() => {
    let cancelled = false;
    apiGetCalendar(FETCH_DAYS[range])
      .then((d) => !cancelled && setCalRange(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Weakness — fetched once, shared with two cards.
  useEffect(() => {
    let cancelled = false;
    apiGetWeakness(50)
      .then((d) => !cancelled && setWeakness(d))
      .catch((e: unknown) => !cancelled && setWeakError(e instanceof Error ? e.message : '获取薄弱点失败'));
    return () => {
      cancelled = true;
    };
  }, []);

  const { current, previous, windowLen } = useMemo(() => {
    if (!calRange || calRange.length < 2) {
      return { current: [] as CalendarDay[], previous: [] as CalendarDay[], windowLen: 0 };
    }
    const half = Math.floor(calRange.length / 2);
    return {
      current: calRange.slice(-half),
      previous: calRange.slice(0, half),
      windowLen: half,
    };
  }, [calRange]);

  const kpis: KpiItem[] | null = useMemo(() => {
    if (!calRange) return null;
    const curAcc = avgAcc(current);
    const prevAcc = avgAcc(previous);
    const curSent = sumSent(current);
    const prevSent = sumSent(previous);
    const curAct = activeDays(current);
    const prevAct = activeDays(previous);
    const streak = snapshot.streak?.current ?? 0;
    return [
      {
        label: '准确率',
        value: curAcc != null ? `${Math.round(curAcc * 100)}%` : '—',
        delta: curAcc != null && prevAcc != null ? (curAcc - prevAcc) * 100 : 0,
        spark: current.map((d) => (d.accuracy ?? 0) * 100),
      },
      {
        label: `近${windowLen}天句数`,
        value: String(curSent),
        delta: prevSent ? ((curSent - prevSent) / prevSent) * 100 : 0,
        spark: current.map((d) => d.sentences_count),
      },
      {
        label: '连续打卡',
        value: `${streak} 天`,
        delta: 0,
        spark: Array.from({ length: Math.max(2, streak) }, (_, i) => i + 1),
      },
      {
        label: '活跃天数',
        value: `${curAct} / ${windowLen}`,
        delta: prevAct ? ((curAct - prevAct) / prevAct) * 100 : 0,
        spark: current.map((d) => (d.sentences_count > 0 ? 1 : 0)),
      },
    ];
  }, [calRange, current, previous, windowLen, snapshot.streak?.current]);

  return (
    <div className={styles.root}>
      <DataCommandBar range={range} metric={metric} onRange={setRange} onMetric={setMetric} />

      {kpis ? (
        <KpiStrip items={kpis} />
      ) : (
        <div className={styles.loadingRow}>
          <LoadingMark />
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.col8}>
          {calRange ? (
            <TrendChart
              current={current}
              previous={previous}
              metric={metric}
              onSelectDay={setDrawerDate}
            />
          ) : (
            <div className={`${card.card} ${styles.loadingCard}`}>
              <LoadingMark />
            </div>
          )}
        </div>
        <div className={styles.col4stack}>
          <HeatmapPanel days={calHeat} onSelectDay={setDrawerDate} />
          <GoalRings daily={snapshot.daily_goal} totalSentences={snapshot.lifetime?.total_sentences} />
        </div>
      </div>

      <InsightsRow snapshot={snapshot} current={current} previous={previous} windowLen={windowLen} />

      <div className={styles.grid}>
        <div className={styles.col8}>
          <WeakPointsSection
            data={weakness}
            loading={weakness == null && weakError == null}
            error={weakError}
            userId={snapshot.user.id}
            onStartLib={onStartLib}
          />
        </div>
        <div className={styles.col4}>
          <DistributionPanel data={weakness} />
        </div>
      </div>

      <LearnedLibProgress userId={snapshot.user.id} />

      <AnimatePresence>
        {drawerDate ? (
          <DayDetailDrawer date={drawerDate} onClose={() => setDrawerDate(null)} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
