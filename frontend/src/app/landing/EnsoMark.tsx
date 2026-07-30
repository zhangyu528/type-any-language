'use client';

interface EnsoMarkProps {
  /** Pixel size; default 36. Stroke width scales with size. */
  size?: number;
  /** Override ring stroke color (defaults to var(--cm-mint)). */
  color?: string;
  /** Override leaf fill color (defaults to var(--cm-accent)). */
  leafColor?: string;
}

export default function EnsoMark({
  size = 36,
  color,
  leafColor,
}: EnsoMarkProps) {
  const ringStroke = color ?? 'var(--cm-mint-deep)';
  const leafFill = leafColor ?? 'var(--cm-accent)';
  const strokeWidth = Math.max(1.5, size * 0.055);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Type Any Language"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <g transform="rotate(-25 24 24)">
        <circle
          cx="24"
          cy="24"
          r="18"
          fill="none"
          stroke={ringStroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray="100 13"
          strokeDashoffset="3"
          opacity="0.9"
        />
      </g>
      {/* leaf grows out of the ring's open gap */}
      <path
        d="M 38 6 Q 44 4 46 10 Q 42 14 38 6 Z"
        fill={leafFill}
        opacity="0.95"
      />
      <path
        d="M 39 7 Q 42 9 45 10"
        stroke="rgba(0,0,0,0.10)"
        strokeWidth="0.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}