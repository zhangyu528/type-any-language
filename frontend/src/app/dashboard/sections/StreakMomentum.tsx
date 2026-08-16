'use client';

/**
 * StreakMomentum — the overview's dedicated "streak / momentum" cluster.
 *
 * Surfaces four motivation signals that the existing snapshot already
 * computes but the overview never showed:
 *   1. 连续打卡链 — one filled dot per day in the current streak, plus a
 *      ghost "today" dot when today's session hasn't happened yet. Makes
 *      "连续 N 天" tangible (Duolingo-style) instead of a bare number.
 *   2. 断卡风险提醒 — when today isn't done yet but a streak is live, the
 *      nudge lives in TodaySuggestion (which carries a direct "keep going"
 *      CTA). Kept out of this cluster to avoid a second duplicate banner.
 *   3. 下个里程碑 — distance to the next streak badge (7/14/30/60/100).
 *   4. 本月达标天数 — count of goal-hit days in the current month.
 *
 * All values derive from the existing DashboardSnapshot — no new
 * backend endpoint. Pure presentational; snapshot + yearMonth are
 * passed down from page.tsx / OverviewSection.
 */

import { useMemo } from 'react';
import { CalendarDay, StreakInfo } from '../../api';
import styles from './StreakMomentum.module.css';

// Badge thresholds — "距 N 天徽章还差 M 天".
const MILESTONES = [7, 14, 30, 60, 100];
// Cap the rendered dot row so a long streak doesn't overflow the panel.
const MAX_DOTS = 14;

interface StreakMomentumProps {
  streak: StreakInfo;
  calendar: CalendarDay[];
  /** e.g. "2026-08" — prefixes the calendar dates we count as "this month". */
  yearMonth: string;
}

export default function StreakMomentum({
  streak,
  calendar,
  yearMonth,
}: StreakMomentumProps) {
  const atRisk = streak.current > 0 && !streak.today_done;

  const { dotCount, milestone, monthHit } = useMemo(() => {
    const dotCount = Math.min(streak.current, MAX_DOTS);
    const next = MILESTONES.find((m) => m > streak.current) ?? null;
    const milestone =
      next == null
        ? '连续打卡大师'
        : `距 ${next} 天徽章还差 ${next - streak.current} 天`;
    const monthHit = calendar.filter(
      (d) => !d.is_future && d.date.startsWith(yearMonth) && d.goal_hit,
    ).length;
    return { dotCount, milestone, monthHit };
  }, [streak.current, calendar, yearMonth]);

  return (
    <section className={styles.root} aria-label="连续打卡">
      <p className={styles.kicker}>连续打卡</p>

      <p className={styles.headline}>
        <span className={styles.headlineNum}>{streak.current}</span>
        <span className={styles.headlineUnit}>天连续</span>
      </p>

      <div className={styles.row}>
        <div className={styles.dots} aria-hidden="true">
          {Array.from({ length: dotCount }).map((_, i) => (
            <span key={i} className={styles.dot} />
          ))}
          {streak.current > MAX_DOTS ? (
            <span key="more" className={styles.more}>
              +{streak.current - MAX_DOTS}
            </span>
          ) : null}
          {atRisk ? <span className={`${styles.dot} ${styles.dotGhost}`} /> : null}
        </div>
        <span className={styles.milestone}>{milestone}</span>
      </div>

      <div className={styles.stats}>
        <p className={styles.monthHit}>本月已达标 {monthHit} 天</p>
        <p className={styles.longest}>最长纪录 {streak.longest} 天</p>
      </div>
    </section>
  );
}
