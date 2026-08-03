'use client';

/**
 * CalendarCell — one day's box in the 4-week grid.
 *
 * Cell tone is decided by sentences_count vs the (passed-in) daily
 * goal. Today gets a coral outline; future days render muted and
 * non-interactive. Streak nodes get a small 🔥 indicator (using the
 * unicode glyph — no icon library installed).
 *
 * The cell surfaces a screen-reader label that bundles date +
 * activity + goal status, so the grid is navigable without sighted
 * context.
 */

import { CalendarDay } from '../api';
import { parseIsoDate, formatFullCn, isFirstOfMonth } from './calendarDate';
import styles from './CalendarCell.module.css';

export type Tone = 'empty' | 'under' | 'hit' | 'over' | 'future';

function pickTone(day: CalendarDay, dailyGoalTarget: number): Tone {
  if (day.is_future) return 'future';
  if (day.sentences_count === 0) return 'empty';
  const ratio = day.sentences_count / Math.max(1, dailyGoalTarget);
  if (ratio >= 1.5) return 'over';
  if (day.goal_hit || ratio >= 1) return 'hit';
  return 'under';
}

function formatDayNum(iso: string): string {
  const p = parseIsoDate(iso);
  return p ? String(p.day) : '';
}

function isToday(iso: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return iso === today;
}

export interface CalendarCellProps {
  day: CalendarDay;
  // Daily goal target — owned by the parent so tone mapping is
  // consistent across the grid.
  dailyGoalTarget?: number;
  onClick?: (date: string) => void;
}

export default function CalendarCell({ day, dailyGoalTarget = 20, onClick }: CalendarCellProps) {
  const tone = pickTone(day, dailyGoalTarget);
  const dayNum = formatDayNum(day.date);
  const today = isToday(day.date);
  const interactive = !day.is_future;
  // A 4-week window always straddles a month boundary; marking the
  // 1st is what lets the user read "which month am I looking at"
  // off the grid without cross-referencing the header range.
  const monthStart = isFirstOfMonth(day.date);
  const parts = parseIsoDate(day.date);

  const ariaLabel = [
    // Full 年月日 rather than the raw ISO — a screen reader spells
    // "2026-08-04" out as digits and dashes.
    formatFullCn(day.date),
    today ? '今天' : null,
    interactive ? `${day.sentences_count} 句` : '未来',
    interactive && day.accuracy != null ? `准确率 ${Math.round(day.accuracy * 100)}%` : null,
    day.goal_hit ? '达标' : null,
    day.is_streak_node ? 'streak 节点' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className={`${styles.cell} ${styles[tone]} ${today ? styles.today : ''} ${
        monthStart ? styles.monthStart : ''
      }`}
      onClick={interactive && onClick ? () => onClick(day.date) : undefined}
      disabled={!interactive}
      aria-label={ariaLabel}
      title={formatFullCn(day.date)}
      role="gridcell"
    >
      {monthStart && parts ? (
        <span className={styles.monthTag} aria-hidden>
          {parts.month}月
        </span>
      ) : null}
      <span className={styles.num}>{dayNum}</span>
      {day.is_streak_node && !day.is_future ? (
        <span className={styles.streakIcon} aria-hidden>🔥</span>
      ) : null}
    </button>
  );
}