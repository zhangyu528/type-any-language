'use client';

/**
 * GreetingBar — sticky top header on /dashboard.
 *
 * Four pieces of state:
 *   1. Avatar (links to /me)
 *   2. Greeting line (Good {morning|afternoon|evening}, <name>)
 *   3. Streak badge — switches between "keep going" (today done) and
 *      "practice today to reach N+1" (today not done, streak > 0).
 *   4. Monthly goal progress bar — "本月 X / Y 天" + thin bar +
 *      status pill (achieved / on track / behind). Absorbed from the
 *      old CalendarHeader so the rhythm strip below can stay focused
 *      on the current week only.
 *
 * The greeting time-of-day is computed once on mount from the
 * browser's local hour; we don't refresh it (a dashboard session
 * rarely crosses a greeting boundary).
 */

import Link from 'next/link';
import { AnimatedCounter, DecryptedText } from '@/components/effects';
import {
  DashboardUser,
  DailyGoalState,
  MonthlyGoalInfo,
  StreakInfo,
} from '../api';
import styles from './GreetingBar.module.css';

function pickGreeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function pickStreakCopy(streak: StreakInfo): {
  copy: string;
  tone: 'rest' | 'reach' | 'kept';
} {
  if (streak.current === 0) {
    return { copy: 'Start a new streak today', tone: 'reach' };
  }
  if (streak.today_done) {
    return { copy: `🔥 ${streak.current}-day streak · keep it going`, tone: 'kept' };
  }
  return {
    copy: `Practice today to reach ${streak.current + 1}`,
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
  dailyGoal: DailyGoalState;
  monthlyGoal: MonthlyGoalInfo;
}

export default function GreetingBar({
  user,
  streak,
  dailyGoal,
  monthlyGoal,
}: GreetingBarProps) {
  const greeting = pickGreeting(new Date().getHours());
  const display = (user.display_name || user.email || '').trim() || '朋友';
  const streakCopy = pickStreakCopy(streak);
  const monthlyTone = pickMonthlyTone(monthlyGoal);
  const monthlyStatusCopy = pickMonthlyStatusCopy(monthlyTone);
  const monthlyPct =
    monthlyGoal.target > 0
      ? Math.min(100, Math.round((monthlyGoal.current / monthlyGoal.target) * 100))
      : 0;

  // First letter for the avatar — mirrors /me's AccountCard pattern.
  const initial = display.charAt(0).toUpperCase();

  return (
    <header className={styles.root} aria-label="page header">
      <Link href="/me" className={styles.avatar} aria-label="个人中心">
        {initial}
      </Link>
      <div className={styles.meta}>
        <p className={styles.greeting}>
          {greeting}, <span className={styles.name}>{display}</span>
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

      {/* Monthly goal: thin bar + count + status pill.
         Sits to the right of the meta column so the avatar / greeting
         stays left-aligned. Bar fills are theme-aware (use
         --ds-correct-fill / --ds-error / --ds-cta). */}
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
          <AnimatedCounter
            value={monthlyGoal.current}
            duration={900}
            className={styles.monthlyNum}
          />
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
      </div>

      {/* dailyGoal prop is read here so we don't destructure-and-ignore
          warnings in stricter lint configs. The headline goal state is
          surfaced visually in the DailyGoal card below. */}
      <span className={styles.srOnly}>
        Today&apos;s goal: {dailyGoal.today_count} of {dailyGoal.target}
      </span>
    </header>
  );
}