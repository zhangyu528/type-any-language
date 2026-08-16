/**
 * achievements.ts — 共享的徽章派生逻辑。
 *
 * 纯客户端：从 GET /api/dashboard 的 snapshot 推导一组成就徽章
 * （已解锁 / 未解锁 + 进度），以及「下一个最接近解锁的徽章」。
 *
 * 同时被两处复用：
 *   · AchievementWall（成就页 / 主页的徽章墙）——展示完整徽章网格
 *   · QuickNav 的「成就」tile——只取 earnedCount + next 做一行概览
 * 抽成单一真相源，避免两份公式分叉。
 */

import { DashboardSnapshot } from '../../api';

export interface BadgeDef {
  id: string;
  label: string;
  /** sub-label shown when earned */
  earnedSub: string;
  /** sub-label shown when locked; receives current/target */
  lockedSub: (current: number, target: number) => string;
  current: number;
  target: number;
  unit: string;
  earned: boolean;
}

export interface AchievementsModel {
  badges: BadgeDef[];
  earnedCount: number;
  next: BadgeDef | null;
  nextPct: number;
}

function clampPct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export function deriveAchievements(snapshot: DashboardSnapshot): AchievementsModel {
  // ---- derive base metrics from the snapshot (all client-side) ----
  // Prefer the lifetime rollup (all-time, accurate) when present; fall
  // back to the 35-day calendar window for brand-new users.
  const lifetime = snapshot.lifetime ?? null;
  const nonFuture = snapshot.calendar.filter((d) => !d.is_future);
  const totalSentences = lifetime
    ? lifetime.total_sentences
    : nonFuture.reduce((s, d) => s + d.sentences_count, 0);
  const daysPracticed = lifetime
    ? lifetime.days_practiced
    : nonFuture.filter((d) => d.sentences_count > 0).length;

  const created = new Date(snapshot.user.created_at);
  const tenureDays = !isNaN(created.getTime())
    ? Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000))
    : 0;

  const longest = snapshot.streak.longest;
  const maxStreak = Math.max(snapshot.streak.current, longest);

  // Accuracy: prefer lifetime (0–1); otherwise tolerate demo scale
  // (0–100) and backend scale (0–1) from the progress KPI.
  let accuracyPct = 0;
  if (lifetime && lifetime.accuracy != null) {
    accuracyPct = lifetime.accuracy * 100;
  } else {
    const accStat = snapshot.progress?.accuracy_7d ?? snapshot.progress?.accuracy ?? null;
    if (accStat && typeof accStat.value === 'number') {
      accuracyPct = accStat.value > 1.5 ? accStat.value : accStat.value * 100;
    }
  }

  const badges: BadgeDef[] = [
    {
      id: 'first',
      label: '初心者',
      earnedSub: '首句已完成',
      lockedSub: (c) => `还差 ${Math.max(0, 1 - c)} 天`,
      current: daysPracticed,
      target: 1,
      unit: '天',
      earned: daysPracticed >= 1,
    },
    {
      id: 'week',
      label: '七日打卡',
      earnedSub: '连续 7 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: maxStreak,
      target: 7,
      unit: '天',
      earned: maxStreak >= 7,
    },
    {
      id: 'hundred',
      label: '百句达成',
      earnedSub: '累计 100 句',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 句`,
      current: totalSentences,
      target: 100,
      unit: '句',
      earned: totalSentences >= 100,
    },
    {
      id: 'month',
      label: '月度达标',
      earnedSub: '本月已达成',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: snapshot.monthly_goal.current,
      target: snapshot.monthly_goal.target > 0 ? snapshot.monthly_goal.target : 1,
      unit: '天',
      earned: snapshot.monthly_goal.achieved,
    },
    {
      id: 'loyal',
      label: '忠诚学子',
      earnedSub: '学习满 30 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: tenureDays,
      target: 30,
      unit: '天',
      earned: tenureDays >= 30,
    },
    {
      id: 'master',
      label: '连击大师',
      earnedSub: '最长 30 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: longest,
      target: 30,
      unit: '天',
      earned: longest >= 30,
    },
    {
      id: 'sharp',
      label: '精确射手',
      earnedSub: '准确率 90%+',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)}%`,
      current: Math.round(accuracyPct),
      target: 90,
      unit: '%',
      earned: accuracyPct >= 90,
    },
    {
      id: 'diligent',
      label: '勤奋学徒',
      earnedSub: '练习满 20 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: daysPracticed,
      target: 20,
      unit: '天',
      earned: daysPracticed >= 20,
    },
  ];

  const earnedCount = badges.filter((b) => b.earned).length;

  // Next badge = the locked one closest to unlocking (highest %).
  const locked = badges.filter((b) => !b.earned);
  let next: BadgeDef | null = null;
  let nextPct = -1;
  for (const b of locked) {
    const p = clampPct(b.current, b.target);
    if (p > nextPct) {
      nextPct = p;
      next = b;
    }
  }

  return { badges, earnedCount, next, nextPct };
}
