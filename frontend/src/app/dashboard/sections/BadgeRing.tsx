'use client';

/**
 * BadgeRing — 在 BadgeEmblem 周围包裹一圈环形进度条。
 *
 * 用 SVG `<circle>` + `stroke-dasharray` / `stroke-dashoffset` 画进度弧。
 * 透明度表达进度:earned → 1.0,未开始 → 0.3,进行中 → 0.3-1.0 线性插值。
 *
 * earned 状态:统一金色揭示(`--ds-cta` 产品主色),
 *   不论原 accent 是什么颜色,跨 8 个 accent 视觉一致。
 *   通过在 wrap 上加 `wrapEarned` className,内含一组覆盖 BadgeEmblem 的
 *   `--badge-*` CSS 变量(渐变 + 描边 + 图标色都改为金色)。
 *
 * 未获得:走每个 badge 自己的 accent(由 BadgeEmblem.state='locked' 处理灰阶 +
 *   BadgeRing 的 emblemOpacity 透明度叠加)。
 */

import type { BadgeAccent } from './achievements';
import BadgeEmblem from './BadgeEmblem';
import type { BadgeShape, BadgeIconName } from './achievements';
import styles from './BadgeRing.module.css';

interface Props {
  shape: BadgeShape;
  icon: BadgeIconName;
  accent: BadgeAccent;
  earned: boolean;
  /** 0-100 进度百分比。earned 时忽略(强制 100)。 */
  pct: number;
  /** 徽章主体尺寸(不含环形外框),默认 56px。 */
  size?: number;
  className?: string;
  ariaLabel?: string;
}

export default function BadgeRing({
  shape,
  icon,
  accent,
  earned,
  pct,
  size = 56,
  className,
  ariaLabel,
}: Props) {
  // 环形外框宽度 = 4px,与进度条视觉重量匹配
  const ringStroke = 4;
  // viewBox 大小 = 徽章 + 左右各 ringStroke + 4px padding(让 ring 不贴边)
  const padding = 4;
  const viewBoxSize = size + (ringStroke + padding) * 2;
  const center = viewBoxSize / 2;
  const ringRadius = size / 2 + ringStroke / 2 + padding / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const clampedPct = Math.max(0, Math.min(100, pct));
  // earned 强制满弧,跟环形颜色协调;locked 显示 0% 但不画
  const dashOffset = earned
    ? 0
    : circumference * (1 - clampedPct / 100);

  // 透明度表达进度:
  //   earned      → 1.0(原色满色)
  //   未开始(0%)  → 0.3(背景化,极弱可见)
  //   进行中(0-100%) → 0.3 → 1.0 线性插值
  // 视觉隐喻:你越接近解锁,徽章越清晰。
  const baseOpacity = 0.3;
  const maxOpacity = 1.0;
  const emblemOpacity = earned
    ? maxOpacity
    : baseOpacity + (maxOpacity - baseOpacity) * (clampedPct / 100);

  // 进度弧颜色:
  //   earned → 金色 (--ds-cta,跨 accent 一致的"原色")
  //   未获得 → 中性灰
  const ringStrokeColor = earned
    ? 'var(--ds-cta)'
    : 'var(--ds-ink-faint)';

  return (
    <div
      className={`${styles.wrap} ${earned ? styles.wrapEarned : ''} ${className ?? ''}`}
      style={{ width: viewBoxSize, height: viewBoxSize }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        width={viewBoxSize}
        height={viewBoxSize}
        aria-hidden
        className={styles.ring}
      >
        {/* 轨道底色(灰色) — 全圆 */}
        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          className={styles.track}
          strokeWidth={ringStroke}
          fill="none"
        />
        {/* 进度弧 — earned 满弧 + accent glow;未获得中性灰 */}
        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          className={earned ? styles.fillEarned : styles.fill}
          strokeWidth={ringStroke}
          fill="none"
          stroke={ringStrokeColor}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div
        className={styles.emblem}
        style={{ opacity: emblemOpacity }}
      >
        {/* earned → 统一金色 (var(--ds-cta-deep) 是产品主色,跨 accent 一致)。
           未获得 → 走每个 badge 自己的 accent(由 BadgeEmblem.state='locked' 处理灰阶)。 */}
        <BadgeEmblem
          shape={shape}
          icon={icon}
          accent={accent}
          state={earned ? 'earned' : 'locked'}
          size={size}
        />
      </div>
    </div>
  );
}
