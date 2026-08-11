'use client';

import styles from './DriftWall.module.css';

export interface DriftItem {
  name: string;
  en: string;
}

/**
 * DriftWall — React Bits "Drift Wall" 风格的漂浮场景卡墙。
 * 在登录卡的中下部缓慢漂浮，填充标题/表单与底部注册链接之间的空白。
 * 纯装饰:aria-hidden + pointer-events:none，不会遮挡可交互元素。
 */
export function DriftWall({ items }: { items: DriftItem[] }) {
  return (
    <div className={styles.layer} aria-hidden="true">
      {items.map((item, i) => (
        <div key={i} className={styles.chip}>
          <span className={styles.cat}>{item.name}</span>
          <span className={styles.en}>{item.en}</span>
        </div>
      ))}
    </div>
  );
}
