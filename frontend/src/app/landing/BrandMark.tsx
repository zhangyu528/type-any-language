'use client';

/**
 * BrandMark — 3×3 dot matrix that carries the product's "muscle
 * memory" metaphor: a fingertip / finger pad hitting the same area
 * over and over leaves a print that's darkest at the centre and
 * fades out radially.
 *
 * Sizing: defaults to 22px (AppHeader). Hero can pass `size={48}`
 * etc. The matrix cell count and gap stay proportional so the
 * silhouette reads the same at every scale.
 *
 * Animation: `pulse` enables a slow opacity pulse on the centre
 * dot. The header must NOT pulse (always-on motion is distracting
 * in a persistent chrome), so the default is `pulse=false`.
 */

interface BrandMarkProps {
  /** Pixel size of the bounding box. Default 22 (matches header). */
  size?: number;
  /** Whether the centre dot pulses. Use only on large/hero surfaces. */
  pulse?: boolean;
  /** Override centre-dot colour. Defaults to var(--ds-action-deep). */
  centerColor?: string;
}

const MATRIX_SIZE = 3;
const GAP_RATIO = 0.28;
// Centre dot is at full opacity, ring neighbours at 0.55,
// corners at 0.18 — radial falloff from the touch point.
const OPACITY_CENTER = 1;
const OPACITY_NEIGHBOR = 0.55;
const OPACITY_CORNER = 0.18;

export default function BrandMark({
  size = 22,
  pulse = false,
  centerColor,
}: BrandMarkProps) {
  const cell = size / MATRIX_SIZE;
  const dotR = (cell - cell * GAP_RATIO) / 2; // dot radius
  const fill = centerColor ?? 'var(--ds-action-deep)';

  const dots: Array<{ cx: number; cy: number; r: number; op: number }> = [];
  for (let row = 0; row < MATRIX_SIZE; row++) {
    for (let col = 0; col < MATRIX_SIZE; col++) {
      const isCenter = row === 1 && col === 1;
      const isCorner = row === 0 || row === 2 || (col === 0 || col === 2);
      dots.push({
        cx: col * cell + cell / 2,
        cy: row * cell + cell / 2,
        r: dotR,
        op: isCenter ? OPACITY_CENTER : isCorner ? OPACITY_CORNER : OPACITY_NEIGHBOR,
      });
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Type Any Language"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          fill={fill}
          opacity={d.op}
        >
          {pulse && d.op === OPACITY_CENTER ? (
            <animate
              attributeName="opacity"
              values="1;0.35;1"
              dur="1.6s"
              repeatCount="indefinite"
            />
          ) : null}
        </circle>
      ))}
    </svg>
  );
}