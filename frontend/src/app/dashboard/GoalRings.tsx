'use client';

import { DailyGoalState, MonthlyGoalInfo } from '../api';
import ProgressRing from '../ds/components/ProgressRing';
import card from './card.module.css';
import styles from './GoalRings.module.css';

interface Props {
  daily: DailyGoalState;
  monthly: MonthlyGoalInfo;
}

export default function GoalRings({ daily, monthly }: Props) {
  const dailyPct = Math.round((daily.pct ?? 0) * 100);
  const monthlyPct = monthly.target > 0 ? Math.round((monthly.current / monthly.target) * 100) : 0;

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
          <ProgressRing percent={monthlyPct} size={72} strokeWidth={7} />
          <div className={styles.cap}>
            每月 {monthly.target} 句
            <b className={styles.ringNum}>
              {monthly.current}/{monthly.target}
            </b>
          </div>
        </div>
      </div>
    </div>
  );
}
