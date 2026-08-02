'use client';

/**
 * WeeklyCalendar — 4-week activity grid for the dashboard.
 *
 * Layout: 7 columns (Mon-Sun) × 5 rows. 35 days total (today-27 to
 * today). The grid is filled from `days`, which the dashboard passes
 * pre-sorted oldest-first.
 *
 * Each cell uses one of 4 backgrounds driven by sentences_count vs
 * the user's daily_goal:
 *   0            → --cal-empty
 *   1..goal-1    → --cal-under
 *   goal..1.5*goal-1 → --cal-hit
 *   1.5*goal+    → --cal-over
 *
 * Today always gets a coral outline (the strongest color on the page)
 * so the user knows where they are in the streak.
 *
 * Click a non-future cell → open DayDetailDrawer on the right
 * (desktop) or bottom (mobile). Future cells are not interactive.
 */

import { useMemo, useState } from 'react';
import { CalendarDay, MonthlyGoalInfo } from '../api';
import CalendarHeader from './CalendarHeader';
import CalendarCell from './CalendarCell';
import DayDetailDrawer from './DayDetailDrawer';
import styles from './WeeklyCalendar.module.css';

export interface WeeklyCalendarProps {
  days: CalendarDay[];
  monthlyGoal: MonthlyGoalInfo;
}

// Group days into rows of 7 (Mon-Sun). Backend emits ISO date strings;
// we treat them as calendar dates, not wall-clock instants, by
// constructing Date with the YYYY-MM-DD as-is.
function buildRows(days: CalendarDay[]): CalendarDay[][] {
  const rows: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    rows.push(days.slice(i, i + 7));
  }
  return rows;
}

export default function WeeklyCalendar({ days, monthlyGoal }: WeeklyCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(days), [days]);

  return (
    <section className={styles.root} aria-label="recent activity">
      <CalendarHeader monthlyGoal={monthlyGoal} />
      <div className={styles.grid} role="grid" aria-label="4 week activity">
        {/* Weekday header row (Mon, Tue, ..., Sun) */}
        <div className={styles.weekdays} role="row">
          {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
            <span key={d} className={styles.weekday} role="columnheader">
              {d}
            </span>
          ))}
        </div>
        {rows.map((row, ri) => (
          <div key={ri} className={styles.row} role="row">
            {row.map((day) => (
              <CalendarCell
                key={day.date}
                day={day}
                onClick={(d) => {
                  if (!day.is_future) setSelectedDate(d);
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <Legend />
      {selectedDate ? (
        <DayDetailDrawer
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      ) : null}
    </section>
  );
}

function Legend() {
  return (
    <div className={styles.legend} aria-hidden>
      <span className={`${styles.legendSwatch} ${styles.legendEmpty}`} />
      <span className={styles.legendLabel}>无</span>
      <span className={`${styles.legendSwatch} ${styles.legendUnder}`} />
      <span className={styles.legendLabel}>有活动</span>
      <span className={`${styles.legendSwatch} ${styles.legendHit}`} />
      <span className={styles.legendLabel}>达标</span>
      <span className={`${styles.legendSwatch} ${styles.legendOver}`} />
      <span className={styles.legendLabel}>超额</span>
    </div>
  );
}