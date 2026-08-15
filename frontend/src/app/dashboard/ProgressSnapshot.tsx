'use client';

/**
 * ProgressSnapshot — three KPI tiles: accuracy, sentences, new words.
 *
 * Unified console surface: ONE frosted-glass panel, three equal KPI cells
 * separated by hairline dividers. No rotations, no editorial "magazine"
 * scatter — the panel reads as a calm data block, consistent with the rest
 * of the console.
 *
 * Numbers animate 0 → target via Counter when the section enters view.
 * The trend indicator (▲ / ▼ / —) is unchanged: mint for positive,
 * coral for negative, ink-faint for zero.
 */

import { KpiStat } from '../api';
import Counter from '@/components/Counter';
import styles from './ProgressSnapshot.module.css';

export interface ProgressSnapshotProps {
  kpis: Record<string, KpiStat>;
}

/** Target accuracy for the week — used by the gauge track under the
 *  big accuracy tile. Surfaces "how far to goal" without forcing the
 *  user to compute it. 75% matches the backend's "good enough" floor. */
const ACCURACY_TARGET = 75;

function deltaCopy(delta: number): { symbol: string; tone: 'up' | 'down' | 'flat' } {
  if (delta > 0.0001) return { symbol: '▲', tone: 'up' };
  if (delta < -0.0001) return { symbol: '▼', tone: 'down' };
  return { symbol: '—', tone: 'flat' };
}

function HeroAccuracy({ stat }: { stat: KpiStat }) {
  const animateTo = Math.round(stat.value * 100);
  const delta = deltaCopy(stat.delta);
  const deltaText = `${stat.delta >= 0 ? '+' : ''}${Math.round(stat.delta * 100)}%`;
  const fillPct = Math.min(100, animateTo);

  return (
    <div className={`${styles.kpi} ${styles.kpiHero}`}>
      <div className={styles.kicker}>
        <span className={styles.kickerLabel}>准确率</span>
        <span className={`${styles.delta} ${styles[`delta-${delta.tone}`]}`}>
          <span aria-hidden>{delta.symbol}</span> {deltaText}
        </span>
      </div>
      <div className={styles.number}>
        <Counter value={animateTo} fontSize={48} className={styles.counter} />
        <span className={styles.unit} aria-hidden>%</span>
      </div>
      <div className={styles.gauge} aria-hidden="true">
        <div className={styles.gaugeFill} style={{ width: `${fillPct}%` }} />
        <div
          className={styles.gaugeTarget}
          style={{ left: `${ACCURACY_TARGET}%` }}
          title={`目标 ${ACCURACY_TARGET}%`}
        />
      </div>
      <div className={styles.gaugeLegend}>
        <span>0%</span>
        <span className={styles.gaugeTargetLabel}>目标 {ACCURACY_TARGET}%</span>
      </div>
    </div>
  );
}

function SideStat({
  stat,
  label,
  unit,
}: {
  stat: KpiStat;
  label: string;
  unit?: string;
}) {
  const delta = deltaCopy(stat.delta);
  const deltaText = `${stat.delta >= 0 ? '+' : ''}${Math.round(stat.delta)}`;

  return (
    <div className={styles.kpi}>
      <div className={styles.kicker}>
        <span className={styles.kickerLabel}>{stat.label || label}</span>
        <span className={`${styles.delta} ${styles[`delta-${delta.tone}`]}`}>
          <span aria-hidden>{delta.symbol}</span> {deltaText}
        </span>
      </div>
      <div className={styles.sideNumber}>
        <Counter value={Math.round(stat.value)} fontSize={36} className={styles.counter} />
        {unit ? <span className={styles.sideUnit} aria-hidden>{unit}</span> : null}
      </div>
    </div>
  );
}

export default function ProgressSnapshot({ kpis }: ProgressSnapshotProps) {
  const accuracy = kpis.accuracy;
  const sentences = kpis.sentences;
  const newWords = kpis.new_words;

  return (
    <section className={styles.root} aria-label="progress snapshot">
      <header className={styles.sectionHead}>
        <p className={styles.heading}>本周进度</p>
        <p className={styles.headDate}>
          {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
        </p>
      </header>

      <div className={styles.kpis}>
        {accuracy ? <HeroAccuracy stat={accuracy} /> : null}
        {sentences ? (
          <SideStat stat={sentences} label="本周句数" unit="句" />
        ) : null}
        {newWords ? (
          <SideStat stat={newWords} label="本周新词" unit="词" />
        ) : null}
      </div>
    </section>
  );
}
