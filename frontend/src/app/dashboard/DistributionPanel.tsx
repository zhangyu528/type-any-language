'use client';

import { WeaknessPayload } from '../api';
import card from './card.module.css';
import styles from './DistributionPanel.module.css';

function Bars({
  items,
  color,
}: {
  items: { k: string; v: number }[];
  color: string;
}) {
  const mx = Math.max(1, ...items.map((i) => i.v));
  if (items.length === 0) return <p className={styles.empty}>暂无数据</p>;
  return (
    <div className={styles.bars}>
      {items.map((it) => (
        <div key={it.k} className={styles.row}>
          <span className={styles.name}>{it.k}</span>
          <span className={styles.track}>
            <span
              className={styles.fill}
              style={{ width: `${(it.v / mx) * 100}%`, background: color }}
            />
          </span>
          <span className={styles.num}>{it.v}</span>
        </div>
      ))}
    </div>
  );
}

export default function DistributionPanel({ data }: { data: WeaknessPayload | null }) {
  if (!data) {
    return (
      <div className={`${card.card} ${styles.root}`}>
        <div className={styles.chead}>
          <h2 className={styles.title}>分布视图</h2>
        </div>
        <p className={styles.empty}>加载中…</p>
      </div>
    );
  }

  const cefr = [...data.weak_cefr].sort((a, b) => b.wrong - a.wrong);
  const topics = [...data.weak_topics].sort((a, b) => b.wrong - a.wrong).slice(0, 6);

  return (
    <div className={`${card.card} ${styles.root}`}>
      <div className={styles.chead}>
        <h2 className={styles.title}>分布视图</h2>
      </div>

      <div className={styles.block}>
        <p className={styles.blockTitle}>CEFR 等级错误分布</p>
        <Bars items={cefr.map((c) => ({ k: c.cefr, v: c.wrong }))} color="var(--ds-action)" />
      </div>

      <div className={styles.block}>
        <p className={styles.blockTitle}>高频常错话题</p>
        <Bars items={topics.map((t) => ({ k: t.topic, v: t.wrong }))} color="var(--ds-cta)" />
      </div>
    </div>
  );
}
