'use client';

import { DailyGoalState } from '../api';
import { deriveLevel } from './level';
import ProgressRing from '../ds/components/ProgressRing';
import card from './card.module.css';
import styles from './GoalRings.module.css';

interface Props {
  daily: DailyGoalState;
  /** Lifetime total_sentences — drives the second ring's level fill. */
  totalSentences?: number;
}

export default function GoalRings({ daily, totalSentences }: Props) {
  const dailyPct = Math.round((daily.pct ?? 0) * 100);
  const level = deriveLevel(totalSentences);
  // Show fill as the percentage through the current tier so the ring
  // moves every few sentences even on the high tiers.
  const levelPct = level.pct;

  return (
    <div className={`${card.card} ${styles.root}`}>
      <div className={styles.chead}>
        <h2 className={styles.title}>目标进度</h2>
      </div>
      <div className={styles.rings}>
        <div className={styles.ring}>
          <ProgressRing percent={dailyPct} size={72} strokeWidth={7} />
          <div className={styles.cap}>
            每日 {daily.target} 句
            <b className={styles.ringNum}>
              {daily.today_count}/{daily.target}
            </b>
          </div>
        </div>
        <div className={styles.ring}>
          <ProgressRing percent={levelPct} size={72} strokeWidth={7} />
          <div className={styles.cap}>
            Lv{level.level} {level.label}
            <b className={styles.ringNum}>
              {level.capped ? `${level.total}` : `${level.inTier}/${level.tierSize}`}
            </b>
          </div>
        </div>
      </div>
    </div>
  );
}