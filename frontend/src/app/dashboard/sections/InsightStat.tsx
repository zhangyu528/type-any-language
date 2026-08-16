'use client';

/**
 * InsightStat — 极简数据卡（洞察区用）。
 *
 * 版式与「今日建议」(TodaySuggestion) 对齐：左侧 38px 圆角图标 + 右侧
 * 内容列（kicker 标签 / 大数字 / 副文案）。外壳复用全站玻璃卡 token
 * （--ds-glass-surface / --ds-glass-border / --radius-lg / --ds-glass-shadow），
 * 与「今日建议」外壳完全一致。用于「守护计划」这类一眼能读完的简单指标。
 */

import type { ReactNode } from 'react';
import styles from './InsightStat.module.css';

interface InsightStatProps {
  /** 卡片标签（kicker，如「守护计划」）。 */
  title: string;
  /** 大数字（hero）。 */
  value: ReactNode;
  unit?: string;
  sub?: string;
  /** 可选左侧图标（lucide 等），风格与「今日建议」图标一致。 */
  icon?: ReactNode;
  /** 可选强调色（CSS 颜色），覆盖图标默认 --ds-action 色调，用于区分不同卡片。 */
  accent?: string;
}

export default function InsightStat({ title, value, unit, sub, icon, accent }: InsightStatProps) {
  const iconStyle = accent
    ? { color: accent, background: `color-mix(in srgb, ${accent} 14%, transparent)` }
    : undefined;
  return (
    <section className={styles.root} aria-label={title}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true" style={iconStyle}>
          {icon}
        </span>
      ) : null}
      <div className={styles.body}>
        <span className={styles.kicker}>{title}</span>
        <p className={styles.value}>
          <span className={styles.num}>{value}</span>
          {unit ? <span className={styles.unit}>{unit}</span> : null}
        </p>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </div>
    </section>
  );
}
