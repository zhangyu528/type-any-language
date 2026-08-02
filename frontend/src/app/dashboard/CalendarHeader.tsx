'use client';

/**
 * CalendarHeader — title row + monthly goal progress bar.
 *
 * Sits above the grid. No month-picker in v1 (we always render
 * "最近 4 周"; future months can come when the user wants history
 * beyond the current window).
 */

import { MonthlyGoalInfo } from '../api';
import styles from './CalendarHeader.module.css';

export interface CalendarHeaderProps {
  monthlyGoal: MonthlyGoalInfo;
}

export default function CalendarHeader({ monthlyGoal }: CalendarHeaderProps) {
  const pct = monthlyGoal.target > 0
    ? Math.min(100, Math.round((monthlyGoal.current / monthlyGoal.target) * 100))
    : 0;

  const tone = monthlyGoal.achieved
    ? 'achieved'
    : monthlyGoal.on_track
      ? 'onTrack'
      : 'behind';

  return (
    <div className={styles.root}>
      <div className={styles.titleRow}>
        <p className={styles.title}>最近 4 周</p>
        <p className={`${styles.status} ${styles[tone]}`}>
          {monthlyGoal.achieved
            ? '🎉 已完成'
            : monthlyGoal.on_track
              ? '🟢 进度良好'
              : '🟡 落后'}
        </p>
      </div>
      <div className={styles.goal} aria-label={`${monthlyGoal.year_month} 进度 ${pct}%`}>
        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${styles[tone]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={styles.goalText}>
          {monthlyGoal.current} / {monthlyGoal.target} 句
        </p>
      </div>
    </div>
  );
}