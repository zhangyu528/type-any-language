'use client';

/**
 * ProgressSnapshot — three KPI tiles: accuracy, sentences, new words.
 *
 * Layout: magazine spec sheet. Three cards are scattered across the
 * panel with subtle rotations (2° / -3° / 1°), like a design weekly's
 * data spread. A bold horizontal band crosses the middle as the
 * "section divider / accent" — slate-400 on light, amber on dark, to
 * give the panel a strong editorial anchor without text.
 *
 * Numbers animate 0 → target via AnimatedCounter when the section
 * enters the viewport. Accuracy's "%" sits next to the counter as a
 * static sibling so the unit doesn't dance.
 *
 * The trend indicator (▲ / ▼ / —) is unchanged: mint for positive,
 * coral for negative, ink-faint for zero.
 */

import { KpiStat } from '../api';
import { AnimatedCounter, GlassSurface } from '@/components/effects';
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
    <div className={`${styles.tile} ${styles.tileHero}`}>
      <div className={styles.kicker}>
        <span className={styles.kickerLabel}>准确率</span>
        <span className={`${styles.delta} ${styles[`delta-${delta.tone}`]}`}>
          <span aria-hidden>{delta.symbol}</span> {deltaText}
        </span>
      </div>
      <div className={styles.number}>
        <AnimatedCounter
          value={animateTo}
          startOnView
          duration={1200}
          className={styles.counter}
        />
        <span className={styles.unit} aria-hidden>%</span>
      </div>
      {/* Gauge: thin track from 0 → target% with a marker at the
          target. The fill is the current % (clamped to 100% so we
          don't draw past the marker). */}
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
  index,
}: {
  stat: KpiStat;
  label: string;
  unit?: string;
  index: number;
}) {
  const delta = deltaCopy(stat.delta);
  const deltaText = `${stat.delta >= 0 ? '+' : ''}${Math.round(stat.delta)}`;
  // Each side stat gets its own scatter rotation via index key.
  const scatterClass = index === 0 ? styles.tileScatterA : styles.tileScatterB;

  return (
    <div className={`${styles.tile} ${styles.tileSide} ${scatterClass}`}>
      <div className={styles.kicker}>
        <span className={styles.kickerLabel}>{stat.label || label}</span>
        <span className={`${styles.delta} ${styles[`delta-${delta.tone}`]}`}>
          <span aria-hidden>{delta.symbol}</span> {deltaText}
        </span>
      </div>
      <div className={styles.sideNumber}>
        <AnimatedCounter
          value={Math.round(stat.value)}
          startOnView
          duration={1100}
          className={styles.counter}
        />
        {unit ? <span className={styles.sideUnit} aria-hidden>{unit}</span> : null}
      </div>
      {/* Decorative bar — empty placeholder so the card isn't
          completely "number + nothing". Static, no animation. */}
      <div className={styles.sideBar} aria-hidden="true" />
    </div>
  );
}

export default function ProgressSnapshot({ kpis }: ProgressSnapshotProps) {
  const accuracy = kpis.accuracy;
  const sentences = kpis.sentences;
  const newWords = kpis.new_words;

  return (
    /* GlassSurface — dark mode glass tuning:
         - backgroundOpacity=0.18 → let aurora bleed through
         - distortionScale=-160 → visible edge refraction
         - saturate=1.6 → aurora colors pop through the glass
       The upstream's <LiquidEther> scratch layer is intentionally
       dropped — we don't want interactive background here, just glass. */
    <GlassSurface
      borderRadius={20}
      distortionScale={-160}
      redOffset={0}
      greenOffset={8}
      blueOffset={18}
      blur={9}
      displace={0}
      backgroundOpacity={0.18}
      saturation={1.6}
      mixBlendMode="normal"
      width="100%"
      height="auto"
      className={styles.glass}
    >
      <section className={styles.root} aria-label="progress snapshot">
        <header className={styles.sectionHead}>
          <p className={styles.heading}>本周进度</p>
          <p className={styles.headDate}>
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
          </p>
        </header>

        {/* Magazine spec sheet — three cards scattered with
            deliberate rotations, divided by a bold horizontal band. */}
        <div className={styles.specSheet}>
          {accuracy ? (
            <HeroAccuracy stat={accuracy} />
          ) : null}

          {/* Bold horizontal band — slate on light, amber on dark.
              Reads as "section break" / "editorial accent". */}
          <div className={styles.specBand} aria-hidden="true">
            <span className={styles.specBandLabel}>SPEC · WEEK OF</span>
          </div>

          <div className={styles.sideStack}>
            {sentences ? (
              <SideStat stat={sentences} label="本周句数" unit="句" index={0} />
            ) : null}
            {newWords ? (
              <SideStat stat={newWords} label="本周新词" unit="词" index={1} />
            ) : null}
          </div>
        </div>
      </section>
    </GlassSurface>
  );
}