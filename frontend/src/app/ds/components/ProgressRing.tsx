'use client';

import { motion } from 'motion/react';
import { spring } from '../motion';

/**
 * ProgressRing — 进度环(圆头线帽,进入视口时画圈填充)
 *
 * percent 0-100;size 默认 40;轨道 --ds-tint,进度 --ds-action。
 * reduced-motion 时 motion 的全局降级由页面级配置接管,
 * 这里通过 transition 预设尽量缩短。
 */

export interface ProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  ariaLabel?: string;
}

export default function ProgressRing({
  percent,
  size = 40,
  strokeWidth = 3.5,
  className,
  ariaLabel,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const filled = (clamped / 100) * c;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={ariaLabel ?? `进度 ${Math.round(clamped)}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ds-tint)"
        strokeWidth={strokeWidth}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ds-correct-fill)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        initial={{ strokeDasharray: `0 ${c}` }}
        whileInView={{ strokeDasharray: `${filled} ${c}` }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={spring.soft}
      />
    </svg>
  );
}
