/**
 * achievements.ts — 共享的徽章派生逻辑(双轨异维方案 C)。
 *
 * 纯客户端：从 GET /api/dashboard 的 snapshot 推导一组支线成就徽章
 * (已解锁 / 未解锁 + X/Y 进度),并按"支线类型"分组(频次 / 准确 /
 * 连续 / 量 / 特殊),主轨是等级 XP 路线图(在 AchievementsSection 顶部
 * 单独渲染,本文件不参与)。
 *
 * 同时被两处复用:
 *   · AchievementWall(成就页的徽章网格)— 展示完整分组 + 进度
 *   · QuickNav 的「等级和成就」tile — 只取 earnedCount + next 做一行概览
 * 抽成单一真相源,避免两份公式分叉。
 */

import { DashboardSnapshot } from '../../api';
import {
  Activity,
  Award,
  Calendar,
  CircleDot,
  Crosshair,
  Crown,
  Dumbbell,
  Flame,
  Heart,
  Repeat,
  Sun,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** 徽章形状 — 圆形 / 圆角 / 六角 / 盾 / 椭圆等。 */
export type BadgeShape = 'circle' | 'rounded' | 'hex' | 'shield' | 'pill' | 'diamond';

/** 主色 token — 徽章底色 / 描边 / 光晕。 */
export type BadgeAccent =
  | 'slate' | 'mint' | 'amber' | 'coral' | 'lavender' | 'rose' | 'teal' | 'indigo';

/** 徽章主图标 token。 */
export type BadgeIconName =
  | 'sun' | 'circleDot' | 'calendar' | 'activity'
  | 'crosshair' | 'award' | 'trophy'
  | 'flame' | 'repeat' | 'target'
  | 'zap' | 'crown' | 'heart' | 'dumbbell';

/** 徽章主色 hex 调色板(直接传 SVG stopColor,避开 CSS var in SVG attr 的兼容性)。
 * 与 BadgeEmblem.module.css 的 .accent_${accent} 6 变量保持一一对应。 */
export const ACCENT_PALETTE: Record<BadgeAccent, {
  fillFrom: string;
  fillTo: string;
  stroke: string;
  glow: string;
  color: string;
  iconColor: string;
  iconShadow: string;
}> = {
  slate:    { fillFrom: '#cbd5e1', fillTo: '#94a3b8', stroke: '#64748b', glow: '#94a3b8', color: '#94a3b8', iconColor: '#f8fafc', iconShadow: 'rgba(30, 41, 59, 0.45)' },
  mint:     { fillFrom: '#6ee7b7', fillTo: '#10b981', stroke: '#059669', glow: '#10b981', color: '#10b981', iconColor: '#ecfdf5', iconShadow: 'rgba(6, 78, 59, 0.55)' },
  amber:    { fillFrom: '#fcd34d', fillTo: '#f59e0b', stroke: '#d97706', glow: '#f59e0b', color: '#f59e0b', iconColor: '#fffbeb', iconShadow: 'rgba(120, 53, 15, 0.55)' },
  coral:    { fillFrom: '#fda4af', fillTo: '#fb7185', stroke: '#e11d48', glow: '#fb7185', color: '#fb7185', iconColor: '#fff1f2', iconShadow: 'rgba(136, 19, 55, 0.55)' },
  lavender: { fillFrom: '#c4b5fd', fillTo: '#8b5cf6', stroke: '#7c3aed', glow: '#8b5cf6', color: '#8b5cf6', iconColor: '#f5f3ff', iconShadow: 'rgba(76, 29, 149, 0.55)' },
  rose:     { fillFrom: '#fbcfe8', fillTo: '#ec4899', stroke: '#be185d', glow: '#ec4899', color: '#ec4899', iconColor: '#fdf2f8', iconShadow: 'rgba(131, 24, 67, 0.55)' },
  teal:     { fillFrom: '#5eead4', fillTo: '#14b8a6', stroke: '#0f766e', glow: '#14b8a6', color: '#14b8a6', iconColor: '#f0fdfa', iconShadow: 'rgba(17, 94, 89, 0.55)' },
  indigo:   { fillFrom: '#818cf8', fillTo: '#4f46e5', stroke: '#3730a3', glow: '#4f46e5', color: '#4f46e5', iconColor: '#eef2ff', iconShadow: 'rgba(55, 48, 163, 0.55)' },
};

export const BADGE_ICON_MAP: Record<BadgeIconName, LucideIcon> = {
  sun: Sun,
  circleDot: CircleDot,
  calendar: Calendar,
  activity: Activity,
  crosshair: Crosshair,
  award: Award,
  trophy: Trophy,
  flame: Flame,
  repeat: Repeat,
  target: Target,
  zap: Zap,
  crown: Crown,
  heart: Heart,
  dumbbell: Dumbbell,
};

/** 支线类型 — 路线图右侧的分组标题。 */
export type AchievementTrack = 'frequency' | 'accuracy' | 'streak' | 'volume' | 'special';

export interface BadgeDef {
  id: string;
  /** 主轨类型,AchievementWall 用它做分组。 */
  track: AchievementTrack;
  label: string;
  /** sub-label shown when earned */
  earnedSub: string;
  /** sub-label shown when locked; receives current/target */
  lockedSub: (current: number, target: number) => string;
  /** 当前累计值(用于 X/Y 进度条)。 */
  current: number;
  /** 目标阈值(单维累计;特殊组可能在后端化后再加多维条件)。 */
  target: number;
  unit: string;
  earned: boolean;
  /** 徽章形状 (BadgeEmblem 渲染)。 */
  shape: BadgeShape;
  /** 主图标 token (BADGE_ICON_MAP)。 */
  icon: BadgeIconName;
  /** 主色 — 描边 / 底色。 */
  accent: BadgeAccent;
  /** 灯牌下方一行小字,描述这枚徽章代表什么。 */
  blurb: string;
}

export interface TrackGroup {
  track: AchievementTrack;
  /** 中文分组标题(主轨类型 + 排序键)。 */
  title: string;
  /** 短副标题,放在卡片头,1 行内说清这条支线的意义。 */
  blurb: string;
  badges: BadgeDef[];
}

export interface AchievementsModel {
  tracks: TrackGroup[];
  earnedCount: number;
  totalCount: number;
  /** earnedCount / totalCount (0-1)。 */
  pct: number;
  /** 最近/下一个最接近解锁的徽章(供 QuickNav 概览)。 */
  next: BadgeDef | null;
  nextPct: number;
}

function clampPct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

function byEarnedFirstPct(a: BadgeDef, b: BadgeDef): number {
  // 锁定徽章按"接近解锁"排序(进度高的靠前);已解锁放最后(灰底)。
  if (a.earned && !b.earned) return 1;
  if (!a.earned && b.earned) return -1;
  if (a.earned && b.earned) return a.target - b.target; // 同样 earned 按阈值升序
  return clampPct(b.current, b.target) - clampPct(a.current, a.target);
}

export function deriveAchievements(snapshot: DashboardSnapshot): AchievementsModel {
  // ---- derive base metrics from the snapshot (all client-side) ----
  // Prefer the lifetime rollup (all-time, accurate) when present; fall
  // back to the 35-day calendar window for brand-new users.
  const lifetime = snapshot.lifetime ?? null;
  const nonFuture = snapshot.calendar.filter((d) => !d.is_future);
  const totalCorrect = lifetime ? lifetime.total_correct : 0;
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

  // 薄弱点 "凤凰涅槃" 支线 — 客户端侧从 weakness 字段算"已脱离薄弱"
  // (准确率 >= 80% 的 weak sentence 数)。需要后端薄弱点表(0017 + 已有
  // /api/weakness);前端先接 0 占位,后端字段上线后填 current。
  // NOTE: snapshot 暂无 weakness 字段;这里 hardcode current=0,UI 上
  // 显示"还差 5 个"提示,等后端 weak_count 字段加上后接通。
  const weakDefeatedCount = 0;
  const weakDefeatedTarget = 5;

  // 单 session 100% 准确 — 当前无 session-level 字段,hardcode 0;等
  // /api/dashboard 加 session_best_accuracy 后接通。
  const perfectSessionCount = 0;

  const badges: BadgeDef[] = [
    // ── frequency (频次:累计学习天数) ──
    {
      id: 'freq-first',
      track: 'frequency',
      label: '初心者',
      earnedSub: '首日完成',
      lockedSub: (c) => `还差 ${Math.max(0, 1 - c)} 天`,
      current: daysPracticed,
      target: 1,
      unit: '天',
      earned: daysPracticed >= 1,
      shape: 'circle',
      icon: 'sun',
      accent: 'slate',
      blurb: '起步 — 第一次完成练习',
    },
    {
      id: 'freq-diligent',
      track: 'frequency',
      label: '勤奋学徒',
      earnedSub: '练习满 20 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: daysPracticed,
      target: 20,
      unit: '天',
      earned: daysPracticed >= 20,
      shape: 'rounded',
      icon: 'calendar',
      accent: 'teal',
      blurb: '20 天养成习惯',
    },
    {
      id: 'freq-loyal',
      track: 'frequency',
      label: '忠诚学子',
      earnedSub: '练习满 30 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: daysPracticed,
      target: 30,
      unit: '天',
      earned: daysPracticed >= 30,
      shape: 'shield',
      icon: 'heart',
      accent: 'teal',
      blurb: '30 天不离不弃',
    },

    // ── accuracy (准确率) ──
    {
      id: 'acc-sharp',
      track: 'accuracy',
      label: '精确射手',
      earnedSub: '终身准确率 ≥ 90%',
      lockedSub: (c, t) => `还差 ${Math.max(0, t - c)}%`,
      current: Math.round(accuracyPct),
      target: 90,
      unit: '%',
      earned: accuracyPct >= 90,
      shape: 'circle',
      icon: 'crosshair',
      accent: 'coral',
      blurb: '90% 准确率门槛',
    },
    {
      id: 'acc-sniper',
      track: 'accuracy',
      label: '神射手',
      earnedSub: '终身准确率 ≥ 95%',
      lockedSub: (c, t) => `还差 ${Math.max(0, t - c)}%`,
      current: Math.round(accuracyPct),
      target: 95,
      unit: '%',
      earned: accuracyPct >= 95,
      shape: 'hex',
      icon: 'target',
      accent: 'rose',
      blurb: '95% 准到骨子里',
    },
    {
      id: 'acc-perfect-session',
      track: 'accuracy',
      label: '完美周',
      earnedSub: '单 session 准确率 100%',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 次`,
      current: perfectSessionCount,
      target: 5,
      unit: '次',
      earned: perfectSessionCount >= 5,
      shape: 'diamond',
      icon: 'award',
      accent: 'rose',
      blurb: '5 次单 session 满分',
    },

    // ── streak (连击) ──
    {
      id: 'streak-week',
      track: 'streak',
      label: '七日打卡',
      earnedSub: '连续 7 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: maxStreak,
      target: 7,
      unit: '天',
      earned: maxStreak >= 7,
      shape: 'circle',
      icon: 'flame',
      accent: 'amber',
      blurb: '7 天不间断',
    },
    {
      id: 'streak-fortnight',
      track: 'streak',
      label: '双周坚持',
      earnedSub: '连续 14 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: maxStreak,
      target: 14,
      unit: '天',
      earned: maxStreak >= 14,
      shape: 'hex',
      icon: 'repeat',
      accent: 'amber',
      blurb: '14 天持续',
    },
    {
      id: 'streak-master',
      track: 'streak',
      label: '连击大师',
      earnedSub: '最长 30 天',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
      current: longest,
      target: 30,
      unit: '天',
      earned: longest >= 30,
      shape: 'rounded',
      icon: 'crown',
      accent: 'amber',
      blurb: '30 天王者',
    },

    // ── volume (量;等级 XP 走量×质量,这里徽章只看正确句数累计) ──
    {
      id: 'vol-hundred',
      track: 'volume',
      label: '百句达成',
      earnedSub: '累计正确 100 句',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 句`,
      current: totalCorrect,
      target: 100,
      unit: '句',
      earned: totalCorrect >= 100,
      shape: 'circle',
      icon: 'circleDot',
      accent: 'mint',
      blurb: '100 句正确',
    },
    {
      id: 'vol-thousand',
      track: 'volume',
      label: '千句大师',
      earnedSub: '累计正确 1000 句',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 句`,
      current: totalCorrect,
      target: 1000,
      unit: '句',
      earned: totalCorrect >= 1000,
      shape: 'shield',
      icon: 'zap',
      accent: 'mint',
      blurb: '1000 句准确',
    },

    // ── special (特殊:需要后端 session/weakness 字段上线后接通) ──
    {
      id: 'special-phoenix',
      track: 'special',
      label: '凤凰涅槃',
      earnedSub: '5 句薄弱点升到 80%+',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 句`,
      current: weakDefeatedCount,
      target: weakDefeatedTarget,
      unit: '句',
      earned: weakDefeatedCount >= weakDefeatedTarget,
      shape: 'diamond',
      icon: 'trophy',
      accent: 'indigo',
      blurb: '5 句薄弱点反超 80%+',
    },
    {
      id: 'special-grinder',
      track: 'special',
      label: '死磕到底',
      earnedSub: '错句反复练到对 10 次',
      lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 次`,
      current: 0, // 等后端 /api/practice-attempts/summary
      target: 10,
      unit: '次',
      earned: false,
      shape: 'pill',
      icon: 'dumbbell',
      accent: 'indigo',
      blurb: '错句反复练到对 ×10',
    },
  ];

  // ── 按 track 分组(顺序固定) ──
  const order: AchievementTrack[] = ['frequency', 'accuracy', 'streak', 'volume', 'special'];
  const trackMeta: Record<AchievementTrack, { title: string; blurb: string }> = {
    frequency: { title: '频次', blurb: '练习日累计 — 习惯比强度重要' },
    accuracy: { title: '准确', blurb: '终身准确率 / 单 session 满分' },
    streak: { title: '连击', blurb: '连续天数 — 不让连击断掉' },
    volume: { title: '量', blurb: '累计正确句数 — 等级 XP 也看这个' },
    special: { title: '特殊', blurb: '薄弱点反超 / 死磕错句 — 高难度' },
  };
  void trackMeta;
  const tracks: TrackGroup[] = order.map((t) => ({
    track: t,
    title: trackMeta[t].title,
    blurb: trackMeta[t].blurb,
    badges: badges
      .filter((b) => b.track === t)
      .slice()
      .sort(byEarnedFirstPct),
  }));

  const earnedCount = badges.filter((b) => b.earned).length;
  const totalCount = badges.length;
  const pct = totalCount > 0 ? earnedCount / totalCount : 0;

  // Next badge = the locked one closest to unlocking (highest X/Y %).
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

  return { tracks, earnedCount, totalCount, pct, next, nextPct };
}
