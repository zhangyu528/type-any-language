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
import { DashboardUser, StreakInfo } from '../api';
import { deriveLevel, LevelInfo } from './level';
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

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface GreetingBarProps {
  user: DashboardUser;
  streak: StreakInfo;
  /** Lifetime total_correct — quality-first XP base. */
  totalCorrect?: number;
  /** Lifetime accuracy 0–1 — drives the accuracy tier boost. */
  accuracy?: number | null;
  /** 今日状态：未达标(落后)=true → 左轨主色冷蓝(--ds-action,与 ContinueCard
   * 卡片 behind 态一致);达标=done → 左轨薄荷绿(--ds-correct)。
   * 不再用琥珀作为落后态警示色,与全局 "琥珀=稀缺 CTA 锚" 视觉预算对齐。 */
  behind: boolean;
}

export default function GreetingBar({
  user,
  streak,
  totalCorrect,
  accuracy,
  behind,
}: GreetingBarProps) {
  const now = new Date();
  const timeBand = pickTimeBand(now.getHours());
  const greeting = pickGreeting(now.getHours());
  const display = (user.display_name || user.email || '').trim() || '朋友';
  const level: LevelInfo = deriveLevel({ totalCorrect, accuracy });

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

      {/* Learning level: tier badge + linear progress through the
         current tier → total lifetime sentences. Pinned to the same
         right slot the old monthly-goal block occupied so the hero
         composition doesn't shift. */}
      <div
        className={styles.level}
        aria-label={`等级 ${level.tierName} (Lv${level.level}),累计正确 ${level.correctCount} 句`}
      >
        <div className={styles.levelHead}>
          <span className={styles.levelBadge}>Lv{level.level}</span>
          <span className={styles.levelLabel}>{level.tierName}</span>
        </div>
        <div
          className={styles.levelTrack}
          role="progressbar"
          aria-valuenow={level.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="本级进度"
        >
          <div className={styles.levelFill} style={{ width: `${level.pct}%` }} />
        </div>
        <p className={styles.levelMeta}>
          <span className={styles.levelTotal}>{level.correctCount}</span>
          <span className={styles.levelSep}>句正确 · 本级 {level.costForNextLevel} XP</span>
          {level.capped ? (
            <span className={styles.levelCapped}>· 已登顶</span>
          ) : (
            <span className={styles.levelNeeded}>· 还差 {level.toNextXp} XP 升级</span>
          )}
        </p>
      </div>
    </header>
  );
}
