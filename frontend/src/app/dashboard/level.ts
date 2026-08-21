/**
 * Learning level — **per-level XP** 递增 + 准确率加成。7 大 tier **只决定
 * 灯牌颜色**,不再决定 XP 收益/成本。
 *
 * 等级范围 0-100(共 101 级),从 0 级开始(还没练习 = Lv0)。
 *
 * **XP 成本(每级递增,N = 0-indexed level):**
 *   Lv0 → Lv1  5 XP     ← 起始
 *   Lv10 → Lv11 12 XP
 *   Lv50 → Lv51 172 XP
 *   Lv99 → Lv100 658 XP
 *   公式:`cost(N) = round(5 + N²/15)` — 凸函数,后段递增幅度更大
 *
 *   累计 XP 到 Lv100:`xpForLevel(100) ≈ 22057`。
 *   95% 准确率(×1.5)用户冲顶约需 14700 正确句;
 *   50% 准确率(×1.0)用户冲顶约需 22000 正确句。
 *
 * **XP 获得:**
 *   `xp = correct`(每个正确句 = 1 XP,无加成)
 *   准确率不再参与 XP 运算,只展示在成就墙 / 准确率相关徽章。
 *
 * **7 大 tier**
 *   青铜(0-13) / 翡翠(14-27) / 黄金(28-41) / 红宝石(42-55) /
 *   紫水晶(56-69) / 蓝宝石(70-84) / 钻石(85-100) — **纯视觉分组**,
 *   决定灯牌颜色 + 浅深两档 + 中央数字,不参与 XP 运算。
 *
 * 灯牌造型统一(纯圆角胶囊 / pill),仅通过 tier 颜色 + 浅/深 + 数字
 * 区分等级。无图标、无 SVG 形状。
 *
 * 后端 schema 已含 `lifetime.total_correct` + `lifetime.accuracy`,
 * 无新后端字段。
 */

/** 7 大 tier 主色 token */
export type EmblemAccent =
  | 'bronze' | 'emerald' | 'gold' | 'ruby' | 'amethyst' | 'sapphire' | 'diamond';

/** Tier 元数据:7 族色 + tier 名 + 起止 level + 副标题 */
export interface TierDef {
  index: number;          // 0..6
  name: string;           // 青铜 / 翡翠 / 黄金 / 红宝石 / 紫水晶 / 蓝宝石 / 钻石
  accent: EmblemAccent;
  levelStart: number;     // 包含
  levelEnd: number;       // 包含
  blurb: string;          // tier 副标题(显示在胶囊下方)
}

/**
 * 7 大 tier 总览 —— 共 14 + 14 + 14 + 14 + 14 + 15 + 16 = 101 级 (0-100)。
 * 早期 tier 14 级,后期 tier 略长(15-16)容纳更高的学习曲线。
 * tier 纯视觉,不影响 XP。
 */
export const TIERS: readonly TierDef[] = [
  { index: 0, name: '青铜',   accent: 'bronze',   levelStart: 0,  levelEnd: 13,  blurb: '萌芽 — 踏入学习之路' },
  { index: 1, name: '翡翠',   accent: 'emerald',  levelStart: 14, levelEnd: 27,  blurb: '扎根 — 句句精确' },
  { index: 2, name: '黄金',   accent: 'gold',     levelStart: 28, levelEnd: 41,  blurb: '蓄能 — 准确率加成发力' },
  { index: 3, name: '红宝石', accent: 'ruby',     levelStart: 42, levelEnd: 55,  blurb: '稳态 — 质量稳定' },
  { index: 4, name: '紫水晶', accent: 'amethyst', levelStart: 56, levelEnd: 69,  blurb: '高阶 — 95% 准确率常态' },
  { index: 5, name: '蓝宝石', accent: 'sapphire', levelStart: 70, levelEnd: 84,  blurb: '登峰 — 千句正确' },
  { index: 6, name: '钻石',   accent: 'diamond',  levelStart: 85, levelEnd: 100, blurb: '化境 — 至高' },
] as const;

export const MAX_LEVEL = 100;

/**
 * 凸函数 XP 成本曲线:`cost(N) = round(5 + N²/15)`,
 * 后段递增幅度递增(后段 = 钻石/蓝宝石难度验证)。
 *
 * 验证关键点:
 *   L0 → L1  5 XP     ← 起步 5 XP(用户要求)
 *   L1 → L2  5 XP
 *   L10 → L11 12 XP
 *   L25 → L26 47 XP
 *   L50 → L51 172 XP
 *   L75 → L76 380 XP
 *   L99 → L100 658 XP
 */
export function costForLevel(level: number): number {
  if (level < 0) return 0;
  return Math.round(5 + (level * level) / 15);
}

/** 累计 XP 阈值:达到该 XP 即升 L(OW L = 0 XP 起点)。
 * O(100) 累加 costForLevel(N) for N=0..L-1。 */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  let total = 0;
  for (let n = 0; n < level; n += 1) {
    total += costForLevel(n);
  }
  return total;
}

/** 通过 XP 反推当前 level(向下取整,XP 达到 xpForLevel(L) 即升 L)。
 * O(100) 累加 costForLevel(N) 与 xp 比较,首次超过 xp 的 N 就是 level - 1,
 * 所以返回 N。XP = 0 → Lv0。 */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 0;
  let consumed = 0;
  for (let n = 0; n < MAX_LEVEL; n += 1) {
    consumed += costForLevel(n);
    if (xp < consumed) return n;
  }
  return MAX_LEVEL;
}

/** 通过 level 推算 tier。 */
export function tierForLevel(level: number): TierDef {
  for (const t of TIERS) {
    if (level >= t.levelStart && level <= t.levelEnd) return t;
  }
  return TIERS[TIERS.length - 1];
}

/** 在 tier 内的 0..1 进度(0 = 刚进 tier,1 = 满 tier 即将升下一 tier)。 */
export function tierProgress(level: number): number {
  const t = tierForLevel(level);
  if (t.levelEnd === t.levelStart) return 1;
  return (level - t.levelStart) / (t.levelEnd - t.levelStart);
}

export interface LevelInfo {
  /** Current level (0..100). */
  level: number;
  /** Current tier (resolved tierDef, 含 accent). */
  tier: TierDef;
  /** Tier 内的 0..1 进度. */
  tierPct: number;
  /** 当前有效 XP (correct × accuracy_tier_boost). */
  xp: number;
  /** 升到下一 level 还需的 XP(MAX_LEVEL 时为 0). */
  toNextXp: number;
  /** 当前 level 在 (xpForLevel(L), xpForLevel(L+1)] 区间内的 0..100. */
  pct: number;
  /** 升下一级所需 XP(当前级成本)。MAX_LEVEL 时为 0。 */
  costForNextLevel: number;
  /** 终身正确句数. */
  correctCount: number;
  /** 终身准确率 0..1. */
  accuracy: number | null;
  /** 当前 level 的浅/深档位(true = 浅,false = 深),LevelEmblem 用. */
  /** — 由 tierProgress 推导:tier 前半段浅,后半段深。 */
  isLightTone: boolean;
  /** 当前 tier index(0..6). */
  tierIndex: number;
  /** 当前 tier name. */
  tierName: string;
  /** 当前 tier blurb. */
  tierBlurb: string;
  /** 是否已达 MAX_LEVEL. */
  capped: boolean;
}

export function generateLevelInfo(input: {
  totalCorrect?: number | null;
  totalSentences?: number | null;
  accuracy?: number | null;
}): LevelInfo {
  const correct = Math.max(0, input.totalCorrect ?? 0);
  const accuracy = input.accuracy ?? null;
  // XP 公式:每个正确句 = 1 XP,无加成(tier / accuracy 都不参与 XP 运算)
  const xp = correct;
  const level = levelForXp(xp);
  const tier = tierForLevel(level);
  const tierIndex = tier.index;
  const tierPct = tierProgress(level);
  // tier 内前半段 → 浅色;后半段 → 深色
  const tierSize = tier.levelEnd - tier.levelStart + 1;
  const withinTier = level - tier.levelStart;
  const isLightTone = withinTier < Math.ceil(tierSize / 2);
  const xpAtThis = xpForLevel(level);
  const xpAtNext = xpForLevel(level + 1);
  const capped = level >= MAX_LEVEL;
  const toNextXp = capped ? 0 : Math.max(0, xpAtNext - xp);
  const pct = capped
    ? 100
    : xpAtNext === xpAtThis
      ? 100
      : Math.min(100, Math.round(((xp - xpAtThis) / (xpAtNext - xpAtThis)) * 100));
  const costForNextLevel = capped ? 0 : xpAtNext - xpAtThis;
  return {
    level,
    tier,
    tierIndex,
    tierPct,
    xp,
    toNextXp,
    pct,
    costForNextLevel,
    correctCount: correct,
    accuracy,
    isLightTone,
    tierName: tier.name,
    tierBlurb: tier.blurb,
    capped,
  };
}

// 旧 API 兼容层:其他模块可能仍用 deriveLevel(input) 调用。
// 新代码请改用 generateLevelInfo(input)。
export function deriveLevel(input: {
  totalCorrect?: number | null;
  totalSentences?: number | null;
  accuracy?: number | null;
}): LevelInfo {
  return generateLevelInfo(input);
}
