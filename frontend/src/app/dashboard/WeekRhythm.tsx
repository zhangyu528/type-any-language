'use client';

/**
 * WeekRhythm — current-week activity strip.
 *
 * Replaces the old 7×5 activity heatmap. Shows 7 large dots
 * (Monday → Sunday), each in one of 5 states:
 *
 *   future       — past today's date within this week, no fill
 *   past-empty   — before today, 0 sentences
 *   today-empty  — today, 0 sentences (gets a coral ring + pulse)
 *   partial      — before today, sentences > 0 but not goal_hit
 *   done         — goal_hit OR (today and goal_hit)
 *
 * Click any non-future dot → open DayDetailDrawer (reused from the
 * old calendar — DayDetailDrawer fetches /api/dashboard/day/{date}
 * and renders the per-session breakdown).
 *
 * The right-side count "本周 X / 7" sums days where
 * sentences_count > 0 (done + partial). Monthly goal progress is
 * NOT shown here — GreetingBar owns it.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDay } from '../api';
import { riseIn, staggerParent } from '../ds/motion';
import DayDetailDrawer from './DayDetailDrawer';
import styles from './WeekRhythm.module.css';

export interface WeekRhythmProps {
  /** Backend's 35-day calendar array (today-27 .. today). We extract
   *  the current-week subset client-side; no API change needed. */
  days: CalendarDay[];
}

type DotState =
  | 'future'
  | 'past-empty'
  | 'today-empty'
  | 'partial'
  | 'done';

/** Build today's ISO `YYYY-MM-DD` using local time (the same convention
 *  the backend emits). */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" without going through `new Date(iso)` (which
 *  parses as UTC midnight and renders in local TZ — see calendarDate.ts). */
function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const y = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  const d = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { y, m, d };
}

/** Shift an ISO date by N days (positive = forward). Uses UTC math
 *  internally so DST never desyncs the day boundary. */
function shiftIso(iso: string, days: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  d.setUTCDate(d.getUTCDate() + days);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Day-of-week → 0=Mon..6=Sun (the convention the week strip uses). */
function dowMondayZero(iso: string): number {
  const p = parseIso(iso);
  if (!p) return 0;
  // Use UTC noon to dodge DST edge cases.
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  const jsDow = d.getUTCDay(); // 0=Sun..6=Sat
  return jsDow === 0 ? 6 : jsDow - 1;
}

function pickState(day: CalendarDay, isToday: boolean): DotState {
  if (day.is_future) return 'future';
  if (day.sentences_count === 0) return isToday ? 'today-empty' : 'past-empty';
  return day.goal_hit ? 'done' : 'partial';
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export default function WeekRhythm({ days }: WeekRhythmProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    const today = todayIso();
    const dow = dowMondayZero(today); // 0..6 with 0=Mon
    const mondayIso = shiftIso(today, -dow);
    const byDate = new Map(days.map((d) => [d.date, d]));

    const out: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = shiftIso(mondayIso, i);
      const found = byDate.get(iso);
      if (found) {
        out.push(found);
      } else {
        // Past day missing from snapshot (rare; only on cold load):
        // fabricate an "empty past" entry so the strip still aligns.
        // Future days of this week (i > dow): synthesize as future.
        const isFuture = iso > today;
        out.push({
          date: iso,
          sentences_count: 0,
          sessions_count: 0,
          accuracy: null,
          goal_hit: false,
          is_future: isFuture,
          is_streak_node: false,
        });
      }
    }
    return { today, week: out };
  }, [days]);

  const today = weekDays.today;
  const week = weekDays.week;
  const activeCount = week.filter(
    (d) => !d.is_future && d.sentences_count > 0
  ).length;

  return (
    <section className={styles.root} aria-label="本周节奏">
      <div className={styles.head}>
        <p className={styles.title}>本周</p>
        <p className={styles.count}>
          <span className={styles.countNum}>{activeCount}</span>
          <span className={styles.countSep}>/</span>
          <span className={styles.countTotal}>7</span>
          <span className={styles.countLabel}>天有练习</span>
        </p>
      </div>

      <motion.div
        className={styles.strip}
        variants={staggerParent}
        initial="hidden"
        animate="show"
        role="list"
        aria-label="本周各日练习状态"
      >
        {week.map((day, i) => {
          const isToday = day.date === today;
          const state = pickState(day, isToday);
          const interactive = state !== 'future';
          return (
            <motion.button
              key={day.date}
              type="button"
              className={`${styles.dot} ${styles[`dot-${state}`]} ${
                isToday ? styles.today : ''
              }`}
              onClick={interactive ? () => setSelectedDate(day.date) : undefined}
              disabled={!interactive}
              aria-label={[
                WEEKDAY_LABELS[i],
                isToday ? '今天' : null,
                day.is_future ? '未来' : `${day.sentences_count} 句`,
                day.goal_hit ? '达标' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              variants={riseIn}
            >
              <span className={styles.dotMark} aria-hidden>
                {state === 'done' ? '✓' : ''}
              </span>
              <span className={styles.dotCount} aria-hidden>
                {!day.is_future && day.sentences_count > 0
                  ? day.sentences_count
                  : ''}
              </span>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Weekday labels (一/二/…/日) — same 7-col grid as the strip so
          each label sits centered under its dot. */}
      <div className={styles.weekdays} aria-hidden>
        {WEEKDAY_LABELS.map((label, i) => {
          const dayIso = week[i]?.date;
          const isToday = dayIso === today;
          return (
            <span
              key={label}
              className={`${styles.weekday} ${isToday ? styles['weekday-today'] : ''}`}
            >
              {label}
            </span>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedDate ? (
          <DayDetailDrawer
            date={selectedDate}
            onClose={() => setSelectedDate(null)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}