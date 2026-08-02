'use client';

/**
 * GreetingBar — sticky top header on /dashboard.
 *
 * Three pieces of state:
 *   1. Avatar (links to /me)
 *   2. Greeting line (Good {morning|afternoon|evening}, <name>)
 *   3. Streak badge — switches between "keep going" (today done) and
 *      "practice today to reach N+1" (today not done, streak > 0).
 *
 * The greeting time-of-day is computed once on mount from the
 * browser's local hour; we don't refresh it (a dashboard session
 * rarely crosses a greeting boundary).
 */

import Link from 'next/link';
import { DashboardUser, DailyGoalState, StreakInfo } from '../api';
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

export interface GreetingBarProps {
  user: DashboardUser;
  streak: StreakInfo;
  dailyGoal: DailyGoalState;
}

export default function GreetingBar({ user, streak, dailyGoal }: GreetingBarProps) {
  const greeting = pickGreeting(new Date().getHours());
  const display = (user.display_name || user.email || '').trim() || '朋友';
  const streakCopy = pickStreakCopy(streak);

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
          {streakCopy.copy}
          {streak.longest > 0 && streak.current > 0 ? (
            <span className={styles.longest}> · 最长 {streak.longest} 天</span>
          ) : null}
        </p>
      </div>
      {/* dailyGoal prop is read here so we don't destructure-and-ignore
          warnings in stricter lint configs. The headline goal state is
          surfaced visually in the DailyGoal card below. */}
      <span className={styles.srOnly}>
        Today's goal: {dailyGoal.today_count} of {dailyGoal.target}
      </span>
    </header>
  );
}