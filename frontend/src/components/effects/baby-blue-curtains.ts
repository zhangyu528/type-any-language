import type { Curtain } from './aurora-background';

/**
 * BABY_BLUE_CURTAINS — the 3-color curtain set tuned to the
 * Baby Blue theme tokens (`[data-babyblue]` in globals.css).
 *
 * RGB values mirror the hex tokens so the canvas-based aurora stays
 * tonally consistent with the rest of the page:
 *   #8FCBF0  (--ds-action)          → [143, 203, 240]
 *   #2F80C0  (--ds-action-deep)     → [47, 128, 192]
 *   #F4A6B0  (--ds-cta)             → [244, 166, 176]
 *
 * Used by:
 *   - /landing   (curtains={BABY_BLUE_CURTAINS})
 *   - /dashboard (curtains={BABY_BLUE_CURTAINS}, since the
 *                 data-babyblue scope was added)
 *
 * Pages WITHOUT data-babyblue (e.g. /practice) keep AuroraBackground
 * defaults — they inherit the slate + amber palette instead.
 *
 * Light/dark balance: AuroraBackground already does `isDark ? screen : source-over`
 * AND boosts opacity 1.6× in light mode. So in light theme these base
 * opacities (0.30 / 0.22 / 0.16) effectively become 0.48 / 0.35 / 0.26 — a
 * soft baby-blue mist. Old values 0.55 / 0.50 / 0.32 produced a saturated
 * "blue watercolour" that washed out hero text and made the page read as
 * "blue" instead of "light".
 */
export const BABY_BLUE_CURTAINS: Curtain[] = [
  {
    color: [143, 203, 240],
    baseY: 0.3,
    amp: 40,
    freq: 0.0012,
    speed: 0.12,
    opacity: 0.30,
    width: 320,
    phase: 0,
    pulseSpeed: 0.35,
    pulseDepth: 0.35,
    driftSpeed: 0.08,
    driftRange: 0.08,
    sweepSpeed: 0.06,
    sweepRange: 30,
    breatheSpeed: 0.1,
    breatheRange: 60,
    ampSpeed: 0.15,
    ampRange: 0.4,
  },
  {
    color: [47, 128, 192],
    baseY: 0.5,
    amp: 55,
    freq: 0.001,
    speed: 0.1,
    opacity: 0.22,
    width: 380,
    phase: Math.PI * 0.7,
    pulseSpeed: 0.28,
    pulseDepth: 0.3,
    driftSpeed: 0.06,
    driftRange: 0.06,
    sweepSpeed: 0.05,
    sweepRange: 40,
    breatheSpeed: 0.08,
    breatheRange: 70,
    ampSpeed: 0.12,
    ampRange: 0.35,
  },
  {
    color: [244, 166, 176],
    baseY: 0.42,
    amp: 35,
    freq: 0.0014,
    speed: 0.15,
    opacity: 0.16,
    width: 300,
    phase: Math.PI * 1.3,
    pulseSpeed: 0.42,
    pulseDepth: 0.4,
    driftSpeed: 0.1,
    driftRange: 0.07,
    sweepSpeed: 0.07,
    sweepRange: 25,
    breatheSpeed: 0.12,
    breatheRange: 50,
    ampSpeed: 0.18,
    ampRange: 0.5,
  },
];