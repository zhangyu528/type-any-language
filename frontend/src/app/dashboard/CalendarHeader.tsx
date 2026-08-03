'use client';

/**
 * CalendarHeader — title row + monthly goal progress bar.
 *
 * Sits above the grid. No month-picker in v1 (we always render the
 * trailing 4-week window; future months can come when the user wants
 * history beyond it). The title carries the window's actual date
 * span ("2026年7月8日 – 8月4日") so the grid isn't just anonymous
 * squares — `rangeStart` / `rangeEnd` are the first and last days
 * the parent handed to the grid.
 */

import { MonthlyGoalInfo } from '../api';
import { formatRangeCn, formatYearMonthCn } from './calendarDate';
import styles from './CalendarHeader.module.css';

export interface CalendarHeaderProps {
  monthlyGoal: MonthlyGoalInfo;
  /** ISO date of the grid's first cell. Omit to fall back to "最近 4 周". */
  rangeStart?: string;
  /** ISO date of the grid's last cell. */
  rangeEnd?: string;
}

export default function CalendarHeader({
  monthlyGoal,
  rangeStart,
  rangeEnd,
}: CalendarHeaderProps) {
  const pct = monthlyGoal.target > 0
    ? Math.min(100, Math.round((monthlyGoal.current / monthlyGoal.target) * 100))
    : 0;

  const tone = monthlyGoal.achieved
    ? 'achieved'
    : monthlyGoal.on_track
      ? 'onTrack'
      : 'behind';

  const span =
    rangeStart && rangeEnd ? formatRangeCn(rangeStart, rangeEnd) : null;

  return (
    <div className={styles.root}>
      <div className={styles.titleRow}>
        <div className={styles.titleGroup}>
          <p className={styles.title}>最近 4 周</p>
          {span ? <p className={styles.range}>{span}</p> : null}
        </div>
        <p className={`${styles.status} ${styles[tone]}`}>
          {monthlyGoal.achieved
            ? '🎉 已完成'
            : monthlyGoal.on_track
              ? '🟢 进度良好'
              : '🟡 落后'}
        </p>
      </div>
      <div
        className={styles.goal}
        aria-label={`${formatYearMonthCn(monthlyGoal.year_month)} 进度 ${pct}%`}
      >
        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${styles[tone]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={styles.goalText}>
          {formatYearMonthCn(monthlyGoal.year_month)} · {monthlyGoal.current} /{' '}
          {monthlyGoal.target} 句
        </p>
      </div>
    </div>
  );
}