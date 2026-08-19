'use client';

import { useMemo, useState } from 'react';
import { CalendarDay } from '../api';
import { MetricKey } from './analytics.types';
import card from './card.module.css';
import styles from './TrendChart.module.css';

interface Props {
  current: CalendarDay[];
  previous: CalendarDay[];
  metric: MetricKey;
  onSelectDay?: (date: string) => void;
}

const W = 720;
const H = 240;
const PADX = 44;
const PADY = 16;
const PADB = 28;

function fmtMd(iso: string): string {
  const p = iso.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}` : iso;
}

function metricValue(d: CalendarDay, metric: MetricKey): number | null {
  if (metric === 'accuracy') return d.accuracy;
  if (metric === 'sessions') return d.sessions_count;
  return d.sentences_count;
}

export default function TrendChart({ current, previous, metric, onSelectDay }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const sorted = [...current].sort((a, b) => a.date.localeCompare(b.date));
    const prev = [...previous].sort((a, b) => a.date.localeCompare(b.date));
    const n = sorted.length;
    const innerW = W - PADX * 2;
    const innerH = H - PADY - PADB;
    const isPct = metric === 'accuracy';

    const curVals = sorted.map((d) => metricValue(d, metric));
    const prevVals = prev.map((d) => metricValue(d, metric));
    const maxRaw = Math.max(
      1,
      ...curVals.filter((v): v is number => v != null),
      ...prevVals.filter((v): v is number => v != null),
    );
    const yMax = isPct ? 1 : maxRaw * 1.1;

    const x = (i: number) => (n <= 1 ? PADX + innerW / 2 : PADX + (i / (n - 1)) * innerW);
    const y = (v: number) => PADY + innerH - (v / yMax) * innerH;

    const toPts = (vals: (number | null)[]) =>
      vals
        .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
        .filter((p): p is string => p !== null)
        .join(' L ');

    const curLine = n > 0 ? `M ${toPts(curVals)}` : '';
    const prevLine = prev.length > 0 ? `M ${toPts(prevVals)}` : '';
    const area =
      curVals.filter((v) => v != null).length > 0
        ? `M ${PADX},${PADY + innerH} L ${toPts(curVals)} L ${x(n - 1)},${PADY + innerH} Z`
        : '';

    const ticks: { x: number; label: string }[] = [];
    if (n > 0) {
      const idxs = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
      for (const i of idxs) ticks.push({ x: x(i), label: fmtMd(sorted[i].date) });
    }

    const curMean = avg(curVals);
    const prevMean = avg(prevVals);

    return { n, innerH, sorted, curLine, prevLine, area, ticks, x, y, curMean, prevMean, isPct };
  }, [current, previous, metric]);

  if (model.n === 0) {
    return (
      <div className={`${card.card} ${styles.root}`}>
        <div className={styles.chead}>
          <h2 className={styles.title}>趋势分析</h2>
        </div>
        <p className={styles.empty}>暂无趋势数据。</p>
      </div>
    );
  }

  const baselineY = PADY + model.innerH;
  const col = model.isPct ? 'var(--ds-correct-fill)' : 'var(--ds-action)';
  const fmt = (v: number) => (model.isPct ? `${Math.round(v * 100)}%` : String(Math.round(v)));
  const hoverDay = hover != null ? model.sorted[hover] : null;

  return (
    <div className={`${card.card} ${styles.root}`}>
      <div className={styles.chead}>
        <h2 className={styles.title}>趋势分析</h2>
        <span className={styles.hint}>
          本期均值 {fmt(model.curMean)}
          {' · '}上期 {fmt(model.prevMean)}
        </span>
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatchCur} aria-hidden /> 本期
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchPrev} aria-hidden /> 上期
        </span>
      </div>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="练习趋势图：本期与上期对比"
        onMouseLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3, 4].map((g) => {
          const gy = PADY + (model.innerH / 4) * g;
          return <line key={g} x1={PADX} y1={gy} x2={W - PADX} y2={gy} className={styles.grid} />;
        })}

        <line x1={PADX} y1={baselineY} x2={W - PADX} y2={baselineY} className={styles.axis} />

        {model.area ? <path d={model.area} className={styles.area} /> : null}
        {model.prevLine ? (
          <path d={model.prevLine} className={styles.linePrev} fill="none" />
        ) : null}
        {model.curLine ? <path d={model.curLine} className={styles.lineCur} fill="none" /> : null}

        {model.sorted.map((d, i) => {
          const v = metricValue(d, metric);
          if (v == null) return null;
          return (
            <circle
              key={d.date}
              cx={model.x(i)}
              cy={model.y(v)}
              r={hover === i ? 5 : 3.2}
              fill={col}
              className={styles.pt}
              onMouseEnter={() => setHover(i)}
              onClick={() => !d.is_future && onSelectDay?.(d.date)}
            />
          );
        })}

        {model.ticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 8} className={styles.tick} textAnchor="middle">
            {t.label}
          </text>
        ))}

        {hoverDay && hover != null && metricValue(hoverDay, metric) != null ? (
          <g className={styles.tip} pointerEvents="none">
            <line
              x1={model.x(hover)}
              y1={PADY}
              x2={model.x(hover)}
              y2={baselineY}
              className={styles.tipLine}
            />
            <text x={model.x(hover)} y={PADY - 2} textAnchor="middle" className={styles.tipText}>
              {fmtMd(hoverDay.date)} · {fmt(metricValue(hoverDay, metric) as number)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function avg(vals: (number | null)[]): number {
  const xs = vals.filter((v): v is number => v != null);
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
