'use client';

/**
 * GreetingBar — compact top header on the dashboard overview.
 *
 * Three pieces of state (identity now lives in the sidebar, so no
 * avatar here):
 *   1. Greeting line (早上好/下午好/晚上好, <name>)
 *   2. Streak badge — a pill that reads as the page's lead momentum
 *      signal: "keep going" (today done) vs "practice today to reach
 *      N+1" (today not done, streak > 0).
 *   3. Monthly goal progress — "本月 X / Y 天" + thin bar + status
 *      pill (achieved / on track / behind). The count is a static
 *      number (no count-up) so it doesn't fight the streak's sweep
 *      animation for attention.
 *
 * The greeting time-of-day is computed once on mount from the
 * browser's local hour; we don't refresh it.
 */

import DecryptedText from '@/components/DecryptedText';
import { DashboardUser, MonthlyGoalInfo, StreakInfo } from '../api';
import styles from './GreetingBar.module.css';

function pickGreeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function pickStreakCopy(streak: StreakInfo): {
  copy: string;
  tone: 'rest' | 'reach' | 'kept';
} {
  if (streak.current === 0) {
    return { copy: '今天开始新的连击吧', tone: 'reach' };
  }
  if (streak.today_done) {
    return { copy: `🔥 连续 ${streak.current} 天 · 继续保持`, tone: 'kept' };
  }
  return {
    copy: `今天再练一下,冲到 ${streak.current + 1} 天`,
    tone: 'reach',
  };
}

type MonthlyTone = 'achieved' | 'onTrack' | 'behind';

function pickMonthlyTone(goal: MonthlyGoalInfo): MonthlyTone {
  if (goal.achieved) return 'achieved';
  if (goal.on_track) return 'onTrack';
  return 'behind';
}

function pickMonthlyStatusCopy(tone: MonthlyTone): string {
  if (tone === 'achieved') return '🎉 已完成';
  if (tone === 'onTrack') return '🟢 进度良好';
  return '🟡 落后';
}

export interface GreetingBarProps {
  user: DashboardUser;
  streak: StreakInfo;
  monthlyGoal: MonthlyGoalInfo;
}

export default function GreetingBar({
  user,
  streak,
  monthlyGoal,
}: GreetingBarProps) {
  const greeting = pickGreeting(new Date().getHours());
  const display = (user.display_name || user.email || '').trim() || '朋友';

  // Tenure: days since the account was created — a soft commitment
  // signal ("学习第 N 天"). SSR-safe: created_at is always present
  // from the API, but guard the parse in case it's malformed.
  const created = new Date(user.created_at);
  const tenureDays =
    !isNaN(created.getTime())
      ? Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000))
      : null;

  const streakCopy = pickStreakCopy(streak);
  const monthlyTone = pickMonthlyTone(monthlyGoal);
  const monthlyStatusCopy = pickMonthlyStatusCopy(monthlyTone);
  const monthlyPct =
    monthlyGoal.target > 0
      ? Math.min(100, Math.round((monthlyGoal.current / monthlyGoal.target) * 100))
      : 0;

  // Pace projection: how many sentences/day are still needed to hit the
  // monthly target by month-end. Surfaces as a one-line hint under the
  // bar — "预计可达成" when on track, "还差 N 句/天" when behind.
  const monthlyHint = (() => {
    if (monthlyGoal.achieved) return { text: '已完成', tone: 'achieved' as const };
    const [y, m] = monthlyGoal.year_month.split('-').map(Number);
    if (!y || !m) return { text: '', tone: 'onTrack' as const };
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysLeft = Math.max(1, daysInMonth - new Date().getDate());
    const needed = Math.max(0, monthlyGoal.target - monthlyGoal.current);
    const perDay = Math.ceil(needed / daysLeft);
    return monthlyGoal.on_track
      ? { text: '预计可达成', tone: 'onTrack' as const }
      : { text: `还差 ${perDay} 句/天`, tone: 'behind' as const };
  })();

  return (
    <header className={styles.root} aria-label="page header">
      <div className={styles.meta}>
        <p className={styles.greeting}>
          {greeting}, <span className={styles.name}>{display}</span>
          {tenureDays != null && tenureDays > 0 ? (
            <span className={styles.tenure}>第 {tenureDays} 天</span>
          ) : null}
        </p>
        <p
          className={`${styles.streak} ${styles[`streak-${streakCopy.tone}`]}`}
          aria-live="polite"
        >
          {/* DecryptedText sweeps through `·` characters (no flicker)
             to reveal the streak copy. See tuning notes in
             components/effects/decrypted-text.tsx. */}
          <DecryptedText
            text={streakCopy.copy}
            animateOn="view"
            speed={80}
            sequential
            revealDirection="start"
            characters="·"
            className={styles.streakDecoded}
            encryptedClassName={styles.streakEncrypted}
          />
          {streak.longest > 0 && streak.current > 0 ? (
            <span className={styles.longest}> · 最长 {streak.longest} 天</span>
          ) : null}
        </p>
      </div>

      {/* Monthly goal: thin bar + count + status pill, pinned right. */}
      <div
        className={styles.monthly}
        aria-label={`本月目标 ${monthlyGoal.current} / ${monthlyGoal.target} 天`}
      >
        <div className={styles.monthlyTrack}>
          <div
            className={`${styles.monthlyFill} ${styles[`monthlyFill-${monthlyTone}`]}`}
            style={{ width: `${monthlyPct}%` }}
          />
        </div>
        <p className={styles.monthlyText}>
          <span className={styles.monthlyLabel}>本月</span>
          <span className={styles.monthlyNum}>{monthlyGoal.current}</span>
          <span className={styles.monthlySep}>/</span>
          <span className={styles.monthlyTotal}>{monthlyGoal.target}</span>
          <span className={styles.monthlyUnit}>天</span>
          <span
            className={`${styles.monthlyStatus} ${styles[`status-${monthlyTone}`]}`}
            aria-label={monthlyStatusCopy}
          >
            {monthlyStatusCopy}
          </span>
        </p>
        {monthlyHint.text ? (
          <p className={`${styles.monthlyHint} ${styles[`hint-${monthlyHint.tone}`]}`}>
            {monthlyHint.text}
          </p>
        ) : null}
      </div>
    </header>
  );
}
