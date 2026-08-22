'use client';

/**
 * BadgeEmblem — 成就徽章(SVG)。每枚徽章有专属形状 / 主色 / 图标。
 *
 * 6 种 shape:circle / rounded / hex / shield / pill / diamond。状态:
 * locked(褪色但不脱色,保留主色暗示)/ earned(主色满填充 + 浅光晕 +
 * 解锁日期)。
 *
 * 渲染数据从 achievements.ts 的 BadgeDef 注入(每个徽章自带
 * shape / icon / accent / blurb)。主色调色板从 ACCENT_PALETTE 直
 * 接读 hex,不走 CSS var(避免 SVG attr 中的 var() 在某些渲染管线
 * 失效导致渐变退化成黑色)。
 */

import {
  ACCENT_PALETTE,
  BADGE_ICON_MAP,
  type BadgeAccent,
  type BadgeIconName,
  type BadgeShape,
} from './achievements';
import styles from './BadgeEmblem.module.css';

export type BadgeState = 'locked' | 'earned';

interface BadgeEmblemProps {
  shape: BadgeShape;
  icon: BadgeIconName;
  accent: BadgeAccent;
  state?: BadgeState;
  /** 尺寸控制,默认 64px(列表卡)/ 32px(小 chip)。 */
  size?: number;
  className?: string;
  ariaLabel?: string;
}

function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export default function BadgeEmblem({
  shape,
  icon,
  accent,
  state = 'locked',
  size = 64,
  className,
  ariaLabel,
}: BadgeEmblemProps) {
  const Icon = BADGE_ICON_MAP[icon];
  const palette = ACCENT_PALETTE[accent];
  const stroke = Math.max(1, size * 0.05);
  const fillInset = size * 0.12;
  const innerSize = size - fillInset * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = innerSize / 2;
  // SVG 元素 id 必须唯一,同一 accent 多枚徽章共存会冲突 → 拼上稳定 hash。
  const gradId = `badge-grad-${accent}-${shape}-${cx}`;

  return (
    <div
      className={clsx(
        styles.wrap,
        styles[`shape_${shape}`],
        styles[`accent_${accent}`],
        styles[`state_${state}`],
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden
        className={styles.svg}
      >
        <defs>
          {/* 直接传 hex stopColor,不依赖 SVG attr 中的 CSS var(某些渲染管线
             不支持 → 渐变退化成黑色 → 徽章整体发灰)。 */}
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.fillFrom} />
            <stop offset="100%" stopColor={palette.fillTo} />
          </linearGradient>
        </defs>
        {renderShape(shape, cx, cy, r, stroke, gradId, palette)}
        {/* earned 状态:外环 + 光晕 */}
        {state === 'earned' ? (
          <>
            <circle
              cx={cx}
              cy={cy}
              r={r + size * 0.08}
              className={styles.outerRing}
              fill="none"
              stroke={palette.stroke}
              strokeWidth={stroke * 0.6}
              opacity={0.55}
            />
            <circle
              cx={cx}
              cy={cy}
              r={r + size * 0.16}
              fill="none"
              stroke={palette.glow}
              strokeWidth={stroke * 0.3}
              opacity={0.3}
              style={{ animation: 'badge-glow 2.8s var(--ease-out) infinite' }}
            />
          </>
        ) : null}
      </svg>
      <Icon
        size={size * 0.42}
        strokeWidth={2.2}
        className={styles.icon}
        aria-hidden
      />
    </div>
  );
}

function renderShape(
  shape: BadgeShape,
  cx: number,
  cy: number,
  r: number,
  stroke: number,
  gradId: string,
  palette: (typeof ACCENT_PALETTE)[BadgeAccent],
) {
  const fill = `url(#${gradId})`;
  const strokeColor = palette.stroke;
  switch (shape) {
    case 'circle':
      return (
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={strokeColor} strokeWidth={stroke} />
      );
    case 'rounded':
      return (
        <rect
          x={cx - r}
          y={cy - r}
          width={r * 2}
          height={r * 2}
          rx={r * 0.28}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={stroke}
        />
      );
    case 'hex':
      return (
        <polygon
          points={hexPoints(cx, cy, r, 'pointy')}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={stroke}
        />
      );
    case 'shield':
      return (
        <path d={shieldPath(cx, cy, r)} fill={fill} stroke={strokeColor} strokeWidth={stroke} />
      );
    case 'pill':
      return (
        <rect
          x={cx - r}
          y={cy - r * 0.65}
          width={r * 2}
          height={r * 1.3}
          rx={r * 0.65}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={stroke}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={[
            `${cx},${cy - r}`,
            `${cx + r * 0.85},${cy}`,
            `${cx},${cy + r}`,
            `${cx - r * 0.85},${cy}`,
          ].join(' ')}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={stroke}
        />
      );
  }
}

function hexPoints(cx: number, cy: number, r: number, orientation: 'pointy' | 'flat'): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a =
      orientation === 'pointy'
        ? Math.PI / 2 + (i * Math.PI) / 3
        : (i * Math.PI) / 3;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

function shieldPath(cx: number, cy: number, r: number): string {
  const w = r * 1.0;
  const h = r * 1.15;
  const top = cy - h / 2;
  const bot = cy + h / 2;
  return [
    `M ${cx - w} ${top + h * 0.05}`,
    `L ${cx - w} ${cy}`,
    `Q ${cx - w} ${bot - h * 0.05} ${cx} ${bot + h * 0.1}`,
    `Q ${cx + w} ${bot - h * 0.05} ${cx + w} ${cy}`,
    `L ${cx + w} ${top + h * 0.05}`,
    `Z`,
  ].join(' ');
}
