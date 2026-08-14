'use client';

import styles from './DriftWall.module.css';

export interface DriftItem {
  name: string;
  en: string;
}

/**
 * DriftWall — 漂浮场景词卡墙(React Bits "Drift Wall" 风格的轻量版)。
 * 在登录卡的中下部缓慢漂浮,填充标题/表单与底部注册链接之间的空白。
 * 纯装饰:aria-hidden + pointer-events:none,不会遮挡可交互元素。
 * 精简版:默认 3 片、透明度更低,给卡片一点"活气"但不抢输入框注意力。
 */
export function DriftWall({ items }: { items: DriftItem[] }) {
  const shown = items.slice(0, 3);
  return (
    <div className={styles.layer} aria-hidden="true">
      {shown.map((item, i) => (
        <div key={i} className={styles.chip}>
          <span className={styles.cat}>{item.name}</span>
          <span className={styles.en}>{item.en}</span>
        </div>
      ))}
    </div>
  );
}
