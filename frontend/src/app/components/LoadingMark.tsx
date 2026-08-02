'use client';

/**
 * LoadingMark — 3×3 dot matrix where the four neighbours and four
 * corners pulse on staggered phases. Same silhouette as BrandMark
 * (so the loading state and the brand mark feel like the same
 * family), but the animation pattern is different: every dot
 * participates, and the timing pattern reads as "the marks are
 * being typed out one phase at a time" — a visual hint of
 * "actively loading", distinct from BrandMark's single-centre
 * heartbeat.
 *
 * Reuses the BrandMark layout (3×3 grid, radial opacity falloff)
 * but every dot animates with a phase delay keyed to its grid
 * position. The centre stays at full opacity throughout so the
 * silhouette stays anchored.
 */

interface LoadingMarkProps {
  /** Pixel size of the bounding box. Default 32 (comfortable in
   *  centered loading states). */
  size?: number;
  /** Optional override for the centre dot fill. */
  centerColor?: string;
}

const MATRIX_SIZE = 3;
const GAP_RATIO = 0.28;
const CENTER_OPACITY = 1;
const NEIGHBOR_BASE = 0.45;
const NEIGHBOR_PEAK = 0.85;
const CORNER_BASE = 0.15;
const CORNER_PEAK = 0.45;
const DURATION = '1.6s';

export default function LoadingMark({
  size = 32,
  centerColor,
}: LoadingMarkProps) {
  const cell = size / MATRIX_SIZE;
  const dotR = (cell - cell * GAP_RATIO) / 2;
  const fill = centerColor ?? 'var(--ds-action-deep)';

  // Each dot gets a phase delay based on its row, so the pulse
  // sweeps outward from the centre in a wave. Phase order:
  //   centre (0s) → neighbours (0.18s) → corners (0.36s).
  const dots: Array<{
    cx: number;
    cy: number;
    r: number;
    op: number;
    delay: string;
    values: string;
  }> = [];
  for (let row = 0; row < MATRIX_SIZE; row++) {
    for (let col = 0; col < MATRIX_SIZE; col++) {
      const isCenter = row === 1 && col === 1;
      const isCorner = row === 0 || row === 2 || (col === 0 || col === 2);
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      const base = isCenter
        ? CENTER_OPACITY
        : isCorner
          ? CORNER_BASE
          : NEIGHBOR_BASE;
      const peak = isCenter
        ? CENTER_OPACITY
        : isCorner
          ? CORNER_PEAK
          : NEIGHBOR_PEAK;
      const delay = isCenter ? '0s' : isCorner ? '0.36s' : '0.18s';
      dots.push({
        cx,
        cy,
        r: dotR,
        op: base,
        delay,
        values: `${base};${peak};${base}`,
      });
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Loading"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={fill} opacity={d.op}>
          <animate
            attributeName="opacity"
            values={d.values}
            dur={DURATION}
            begin={d.delay}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}