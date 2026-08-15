'use client';

/**
 * TrendChart — lightweight SVG line chart for the "数据" partition.
 *
 * Plots two series straight from the dashboard snapshot's `calendar`
 * (the server already returns up to 35 days of per-day
 * sentences_count + accuracy — no new endpoint required):
 *   - 每日句数  → primary action line (left scale, absolute counts)
 *   - 每日准确率 → mint line (right scale, 0–100%)
 *
 * No charting library — just SVG paths, so the console stays
 * dependency-free and the bundle stays small. Theme-aware via CSS
 * custom properties resolved through inline style.
 */

import { useMemo } from 'react';
import { CalendarDay } from '../api';
import styles from './TrendChart.module.css';

interface TrendChartProps {
  days: CalendarDay[];
  /** How many trailing days to draw (defaults to all provided). */
  limit?: number;
}

const W = 600;
const H = 200;
const PADX = 38;
const PADY = 16;
const PADB = 26;

function fmtMd(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

export default function TrendChart({ days, limit }: TrendChartProps) {
  const series = useMemo(() => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const slice = limit && limit > 0 ? sorted.slice(-limit) : sorted;
    const n = slice.length;
    const innerW = W - PADX * 2;
    const innerH = H - PADY - PADB;
    const maxSent = Math.max(1, ...slice.map((d) => d.sentences_count));

    const x = (i: number) => (n <= 1 ? PADX + innerW / 2 : PADX + (i / (n - 1)) * innerW);
    const ySent = (v: number) => PADY + innerH - (v / maxSent) * innerH;
    const yAcc = (v: number | null) => PADY + innerH - (v ?? 0) * innerH;

    const sentPts = slice.map((d, i) => `${x(i).toFixed(1)},${ySent(d.sentences_count).toFixed(1)}`);
    const accPts = slice
      .map((d, i) => (d.accuracy == null ? null : `${x(i).toFixed(1)},${yAcc(d.accuracy).toFixed(1)}`))
      .filter((p): p is string => p !== null);

    // Area under the sentences line (closed path to baseline).
    const areaPath =
      sentPts.length > 0
        ? `M ${PADX},${PADY + innerH} L ${sentPts.join(' L ')} L ${x(n - 1)},${PADY + innerH} Z`
        : '';
    const sentPath = sentPts.length > 0 ? `M ${sentPts.join(' L ')}` : '';
    const accPath = accPts.length > 0 ? `M ${accPts.join(' L ')}` : '';

    // X-axis ticks: first / middle / last.
    const ticks: { x: number; label: string }[] = [];
    if (n > 0) {
      const idxs = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
      for (const i of idxs) ticks.push({ x: x(i), label: fmtMd(slice[i].date) });
    }

    return { n, innerH, maxSent, sentPath, accPath, areaPath, ticks, slice };
  }, [days, limit]);

  if (series.n === 0) {
    return <p className={styles.empty}>暂无趋势数据。</p>;
  }

  const baselineY = PADY + series.innerH;

  return (
    <figure className={styles.root} aria-label="练习趋势图：每日句数与准确率">
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatchSent} aria-hidden /> 每日句数
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchAcc} aria-hidden /> 每日准确率
        </span>
      </div>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-hidden="true"
      >
        {/* baseline */}
        <line
          x1={PADX}
          y1={baselineY}
          x2={W - PADX}
          y2={baselineY}
          className={styles.axis}
        />

        {/* area under sentences */}
        {series.areaPath ? (
          <path d={series.areaPath} className={styles.area} />
        ) : null}

        {/* sentences line */}
        {series.sentPath ? (
          <path d={series.sentPath} className={styles.lineSent} fill="none" />
        ) : null}

        {/* accuracy line */}
        {series.accPath ? (
          <path d={series.accPath} className={styles.lineAcc} fill="none" />
        ) : null}

        {/* x ticks */}
        {series.ticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 8} className={styles.tick} textAnchor="middle">
            {t.label}
          </text>
        ))}
      </svg>

      <p className={styles.caption}>
        近 {series.n} 天 · 峰值 {series.maxSent} 句/天
      </p>
    </figure>
  );
}
