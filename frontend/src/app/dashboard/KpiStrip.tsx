'use client';

import card from './card.module.css';
import styles from './KpiStrip.module.css';

export interface KpiItem {
  label: string;
  value: string;
  /** signed percent change vs the prior equal-length window. */
  delta: number;
  /** raw series for the mini sparkline. */
  spark: number[];
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 72;
  const h = 22;
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`)
    .join(' ');
  return (
    <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

function DeltaTag({ d }: { d: number }) {
  const cls = d > 0.5 ? styles.up : d < -0.5 ? styles.down : styles.flat;
  const arrow = d > 0.5 ? '▲' : d < -0.5 ? '▼' : '—';
  return (
    <span className={`${styles.delta} ${cls}`}>
      {arrow} {Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}%
    </span>
  );
}

export default function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className={styles.root}>
      {items.map((k, i) => {
        const isAcc = k.label === '准确率';
        const color = isAcc ? 'var(--ds-correct-fill)' : 'var(--ds-action)';
        return (
          <div key={i} className={`${card.card} ${styles.card}`}>
            <div className={styles.lab}>{k.label}</div>
            <div className={styles.val}>{k.value}</div>
            <div className={styles.foot}>
              <DeltaTag d={k.delta} />
              <Sparkline values={k.spark} color={color} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
