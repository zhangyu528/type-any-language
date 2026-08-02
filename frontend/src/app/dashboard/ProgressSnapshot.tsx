'use client';

/**
 * ProgressSnapshot — three KPI tiles: accuracy, sentences, new words.
 *
 * Each tile uses useCountUp for the value (so the page reads as
 * "filling up" rather than "snapping in") and a delta indicator
 * (▲ / ▼ / —) for the trend. The trend color is mint for positive,
 * coral for negative, ink-soft for zero.
 *
 * The tile structure mirrors /me/StatsTab's KpiCell but uses
 * `--ds-*` semantic tokens throughout instead of the unstyled
 * .me-kpi classes (which are still half-written on the /me side).
 */

import { KpiStat } from '../api';
import { useCountUp } from '../me/useCountUp';
import styles from './ProgressSnapshot.module.css';

export interface ProgressSnapshotProps {
  kpis: Record<string, KpiStat>;
}

interface TileSpec {
  key: 'accuracy' | 'sentences' | 'new_words';
  label: string;
  /** Format the value for display. Accuracy shows as %, sentences as
   * integer, new_words as integer. */
  format: (n: number) => string;
  /** Trend semantics — false means "lower is better". Used for the
   * ▲/▼ color: accuracy wants positive=good, new_words wants
   * positive=good, sentences wants positive=good. All three are
   * positive-is-good in v1, so we leave higherIsBetter=true. */
  higherIsBetter?: boolean;
}

const TILES: TileSpec[] = [
  { key: 'accuracy',  label: '准确率',    format: (n) => `${Math.round(n * 100)}%` },
  { key: 'sentences', label: '本周句数', format: (n) => String(Math.round(n)) },
  { key: 'new_words', label: '本周新词',  format: (n) => String(Math.round(n)) },
];

function deltaCopy(delta: number): { symbol: string; tone: 'up' | 'down' | 'flat' } {
  if (delta > 0.0001) return { symbol: '▲', tone: 'up' };
  if (delta < -0.0001) return { symbol: '▼', tone: 'down' };
  return { symbol: '—', tone: 'flat' };
}

function Tile({ stat, spec }: { stat: KpiStat; spec: TileSpec }) {
  // For accuracy (0..1) we animate as 0..100 internally so the
  // visible digit count is bigger; then format at render time.
  const raw = stat.value;
  const animateTo = spec.key === 'accuracy' ? raw * 100 : raw;
  const [shown] = useCountUp(animateTo);
  const display = spec.key === 'accuracy'
    ? spec.format(shown / 100)
    : spec.format(shown);

  const delta = deltaCopy(stat.delta);
  // Accuracy delta is in 0..1, others are raw counts. Convert to a
  // human-friendly string.
  const deltaText = spec.key === 'accuracy'
    ? `${stat.delta >= 0 ? '+' : ''}${Math.round(stat.delta * 100)}%`
    : `${stat.delta >= 0 ? '+' : ''}${Math.round(stat.delta)}`;

  return (
    <div className={styles.tile}>
      <p className={styles.value}>{display}</p>
      <p className={styles.label}>{stat.label || spec.label}</p>
      <p className={`${styles.delta} ${styles[`delta-${delta.tone}`]}`}>
        <span aria-hidden>{delta.symbol}</span> {deltaText}
      </p>
    </div>
  );
}

export default function ProgressSnapshot({ kpis }: ProgressSnapshotProps) {
  return (
    <section className={styles.root} aria-label="progress snapshot">
      <p className={styles.heading}>本周进度</p>
      <div className={styles.grid}>
        {TILES.map((spec) => {
          const stat = kpis[spec.key];
          if (!stat) return null;
          return <Tile key={spec.key} stat={stat} spec={spec} />;
        })}
      </div>
    </section>
  );
}