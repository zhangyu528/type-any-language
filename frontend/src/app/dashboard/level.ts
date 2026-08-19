/**
 * Learning level — a soft progression signal derived from the user's
 * lifetime practice volume (total sentences attempted). Pure client-side
 * derivation; the source of truth is `snapshot.lifetime.total_sentences`
 * which the backend already aggregates across all libraries and time
 * windows.
 *
 * Levels are linear (not exponential) so the progress bar inside the
 * current tier feels meaningful — every sentence nudges the bar a
 * visible amount. Tier labels (学徒 / 入门 / ...) double as
 * achievements and as copy inside the hero.
 */

export const LEVEL_TIERS = [
  { level: 1, threshold: 0, label: '学徒', accent: 'slate' },
  { level: 2, threshold: 50, label: '入门', accent: 'mint' },
  { level: 3, threshold: 150, label: '进阶', accent: 'amber' },
  { level: 4, threshold: 300, label: '熟手', accent: 'coral' },
  { level: 5, threshold: 500, label: '高手', accent: 'slate-deep' },
  { level: 6, threshold: 1000, label: '大师', accent: 'mint-deep' },
  { level: 7, threshold: 2000, label: '宗师', accent: 'amber-deep' },
] as const;

export type LevelTier = (typeof LEVEL_TIERS)[number];

export interface LevelInfo {
  /** Current tier (1-indexed). */
  level: number;
  /** Current tier label (学徒 / 入门 / ...). */
  label: string;
  /** Lifetime sentences counted toward this tier. */
  total: number;
  /** Sentences already accumulated within the current tier. */
  inTier: number;
  /** Tier's total width (the "X more to next level" denominator). */
  tierSize: number;
  /** Progress through the current tier, 0–100 (clamped). */
  pct: number;
  /** Sentences still needed to reach the next tier (0 if at max). */
  toNext: number;
  /** True when total has hit or passed the highest tier threshold. */
  capped: boolean;
}

export function deriveLevel(totalSentences: number | undefined | null): LevelInfo {
  const total = Math.max(0, totalSentences ?? 0);
  // Find the highest tier whose threshold has been crossed. Linear
  // walk is fine — there are only 7 tiers.
  let tierIndex = 0;
  for (let i = 0; i < LEVEL_TIERS.length; i += 1) {
    if (total >= LEVEL_TIERS[i].threshold) tierIndex = i;
    else break;
  }
  const tier = LEVEL_TIERS[tierIndex];
  const next = LEVEL_TIERS[tierIndex + 1];
  const tierFloor = tier.threshold;
  const tierCeil = next ? next.threshold : tier.threshold;
  const tierSize = Math.max(1, tierCeil - tierFloor);
  const inTier = Math.min(tierSize, total - tierFloor);
  const capped = !next;
  const toNext = capped ? 0 : Math.max(0, tierCeil - total);
  const pct = capped ? 100 : Math.min(100, Math.round((inTier / tierSize) * 100));
  return {
    level: tier.level,
    label: tier.label,
    total,
    inTier,
    tierSize,
    pct,
    toNext,
    capped,
  };
}