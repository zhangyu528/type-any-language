'use client';

/**
 * GreetingBar — compact top header (the page "hero") on the dashboard
 * overview.
 *
 * Three pieces of state (identity now lives in the sidebar, so no
 * avatar here):
 *   1. Greeting line (早上好/下午好/晚上好, <name>) + soft tenure tag
 *      ("学习第 N 天") + a centered date block (M月D日 · 周X) that fills
 *      the otherwise-empty middle of the bar on wide screens.
 *   2. Streak badge — a pill that reads as the page's lead momentum
 *      signal: "keep going" (today done) vs "practice today to reach
 *      N+1" (today not done, streak > 0). Carries a Flame icon and a
 *      DecryptedText sweep.
 *   3. Monthly goal progress — "本月 X / Y 天" + thin bar + status
 *      pill (achieved / on track / behind). The count is a static
 *      number (no count-up) so it doesn't fight the streak's sweep
 *      animation for attention.
 *
 * Time-of-day theming: the root gets a `data-time` attribute
 * (night / morning / afternoon / evening) that drives a soft corner
 * glow + left accent edge, so the hero feels alive and tied to the
 * moment without being noisy.
 *
 * The greeting time-of-day is computed once on mount from the
 * browser's local hour; we don't refresh it.
 */

import { Flame } from 'lucide-react';
import DecryptedText from '@/components/DecryptedText';
import { DashboardUser, MonthlyGoalInfo, StreakInfo } from '../api';
import styles from './GreetingBar.module.css';

function pickGreeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

type TimeBand = 'night' | 'morning' | 'afternoon' | 'evening';

function pickTimeBand(hour: number): TimeBand {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function pickStreakCopy(streak: StreakInfo): {
  copy: string;
  tone: 'rest' | 'reach' | 'kept';
} {
  if (streak.current === 0) {
    return { copy: '今天开始新的连击吧', tone: 'reach' };
  }
  if (streak.today_done) {
    return { copy: `连续 ${streak.current} 天 · 继续保持`, tone: 'kept' };
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
  if (tone === 'achieved') return '已完成';
  if (tone === 'onTrack') return '进度良好';
  return '落后';
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface GreetingBarProps {
  user: DashboardUser;
  streak: StreakInfo;
  monthlyGoal: MonthlyGoalInfo;
  /** 今日状态：未达标(落后)=true → 左轨琥珀；达标=done → 左轨薄荷绿。 */
  behind: boolean;
}

export default function GreetingBar({
  user,
  streak,
  monthlyGoal,
  behind,
}: GreetingBarProps) {
  const now = new Date();
  const timeBand = pickTimeBand(now.getHours());
  const greeting = pickGreeting(now.getHours());
  const display = (user.display_name || user.email || '').trim() || '朋友';

  const dateDay = `${now.getMonth() + 1}月${now.getDate()}日`;
  const dateWeek = WEEK[now.getDay()];

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

  // Pace projection: how many sentences/day are still needed (on average
  // over the remaining days) to hit the monthly target by month-end.
  // Surfaces as a one-line hint under the bar — "预计可达成" when on
  // track, "日均还需 N 句" when behind (N = daily pace still required).
  const monthlyHint = (() => {
    if (monthlyGoal.achieved) return { text: '已完成', tone: 'achieved' as const };
    const [y, m] = monthlyGoal.year_month.split('-').map(Number);
    if (!y || !m) return { text: '', tone: 'onTrack' as const };
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysLeft = Math.max(1, daysInMonth - now.getDate());
    const needed = Math.max(0, monthlyGoal.target - monthlyGoal.current);
    const perDay = Math.ceil(needed / daysLeft);
  return monthlyGoal.on_track
    ? { text: '预计可达成', tone: 'onTrack' as const }
    : { text: `日均还需 ${perDay} 句`, tone: 'behind' as const };
  })();

  return (
    <header
      className={styles.root}
      data-time={timeBand}
      data-status={behind ? 'behind' : 'done'}
      aria-label="page header"
    >
      <div className={styles.lead}>
        <p className={styles.greeting}>
          {greeting}, <span className={styles.name}>{display}</span>
          {tenureDays != null && tenureDays > 0 ? (
            <span className={styles.tenure}>学习第 {tenureDays} 天</span>
          ) : null}
        </p>
        <p
          className={`${styles.streak} ${styles[`streak-${streakCopy.tone}`]}`}
          aria-label={streakCopy.copy}
        >
          {/* Flame icon + decrypted streak copy. The icon is static;
             DecryptedText sweeps "·" characters (no flicker) to reveal
             the copy. Decorative only — the stable copy lives in the
             parent's aria-label so screen readers announce it once. */}
          <Flame className={styles.streakIcon} aria-hidden="true" size={16} strokeWidth={2.4} />
          <DecryptedText
            text={streakCopy.copy}
            animateOn="view"
            speed={80}
            sequential
            revealDirection="start"
            characters="·"
            className={styles.streakDecoded}
            encryptedClassName={styles.streakEncrypted}
            aria-hidden
          />
          {streak.longest > 0 && streak.current > 0 ? (
            <span className={styles.longest}> · 最长 {streak.longest} 天</span>
          ) : null}
        </p>
      </div>

      {/* Centered date block — fills the empty middle of the bar on wide
         screens, giving the hero a grounded, premium feel. Hidden on
         narrow viewports where it would crowd the layout. */}
      <div className={styles.date} aria-hidden="true">
        <span className={styles.dateDay}>{dateDay}</span>
        <span className={styles.dateWeek}>{dateWeek}</span>
      </div>

      {/* Monthly goal: small header (label + status) → thin bar →
         count → hint, pinned right. The number is the hero of this
         block; "本月目标" sits as a quiet caption above it. */}
      <div
        className={styles.monthly}
        aria-label={`本月目标 ${monthlyGoal.current} / ${monthlyGoal.target} 句`}
      >
        <div className={styles.monthlyHead}>
          <span className={styles.monthlyLabel}>本月目标</span>
          <span
            className={`${styles.monthlyStatus} ${styles[`status-${monthlyTone}`]}`}
            aria-label={monthlyStatusCopy}
          >
            {monthlyStatusCopy}
          </span>
        </div>
        <div className={styles.monthlyTrack}>
          <div
            className={`${styles.monthlyFill} ${styles[`monthlyFill-${monthlyTone}`]}`}
            style={{ width: `${monthlyPct}%` }}
          />
        </div>
        <p className={styles.monthlyText}>
          <span className={styles.monthlyNum}>{monthlyGoal.current}</span>
          <span className={styles.monthlySep}>/</span>
          <span className={styles.monthlyTotal}>{monthlyGoal.target}</span>
          <span className={styles.monthlyUnit}>句</span>
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
