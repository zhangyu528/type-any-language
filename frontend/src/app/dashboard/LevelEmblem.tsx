'use client';

/**
 * LevelEmblem — 100 级等级胶囊(纯 CSS 圆角矩形 + 数字)。
 *
 * 7 档 tier 共享同一形状(纯圆角胶囊 / pill),仅通过:
 *   1. **颜色**(7 段 tier × 浅/深 = 14 档渐变)
 *   2. **中央数字**(胶囊内始终显示等级编号)
 * 来区分等级。
 *
 * 没有图标、没有 SVG master 形状、没有外环装饰 — 全部由
 * CSS 渐变 + 阴影 + 描边承担。
 *
 * 状态:
 *   - locked: 灰度 + 暗化(用户还没升到的等级)
 *   - current: 外发光脉冲(用户当前所在)
 *   - passed: 实心填色 + 弱化(用户已通过的等级,无脉冲)
 *
 * 用途:AchievementsSection 主轨大灯牌 + 下一级预览 + 7 大 tier 缩略条。
 */

import { tierForLevel, type EmblemAccent } from './level';
import styles from './LevelEmblem.module.css';

export type EmblemState = 'locked' | 'current' | 'passed';

interface LevelEmblemProps {
  level: number; // 1..100
  state?: EmblemState;
  /** 胶囊高度(宽度基于字号 + 横向 padding 自动). */
  size?: number;
  className?: string;
  ariaLabel?: string;
  /** 强制显示激活色(去掉 locked 灰度滤镜)。用于父组件 hover 预览
   * 下一级灯牌颜色。 */
  forceActive?: boolean;
}

function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export default function LevelEmblem({
  level,
  state = 'current',
  size = 48,
  className,
  ariaLabel,
  forceActive = false,
}: LevelEmblemProps) {
  const tier = tierForLevel(level);
  const accent: EmblemAccent = tier.accent;
  // tier 内浅/深:level 1..(size/2)-1 浅,level size/2..size 深
  const tierSize = tier.levelEnd - tier.levelStart + 1;
  const withinTier = level - tier.levelStart;
  const isLightTone = withinTier < Math.ceil(tierSize / 2);

  // 字号:等级数字占胶囊高度的 50%(em 联动 size)
  const fontSize = size * 0.5;
  // 横向 padding:让 1 位 / 2 位 / 3 位数字胶囊比例好看
  const paddingX = size * 0.28;
  // 最小宽度:保证 1 位数字也有合适比例
  const minWidth = size * 1.4;

  return (
    <div
      className={clsx(
        styles.wrap,
        styles[`accent_${accent}`],
        isLightTone ? styles.toneLight : styles.toneDeep,
        styles[`state_${state}`],
        forceActive ? styles.forceActive : '',
        className,
      )}
      style={{
        height: size,
        minWidth,
        paddingLeft: paddingX,
        paddingRight: paddingX,
        fontSize,
      }}
      role="img"
      aria-label={ariaLabel ?? `第 ${level} 级 ${tier.name}`}
    >
      <span className={styles.centerNumber} aria-hidden>
        {level}
      </span>
    </div>
  );
}
