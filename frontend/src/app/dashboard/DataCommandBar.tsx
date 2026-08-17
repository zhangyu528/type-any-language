'use client';

import card from './card.module.css';
import { RangeKey, MetricKey } from './analytics.types';
import styles from './DataCommandBar.module.css';

const RANGES: { k: RangeKey; l: string }[] = [
  { k: '7', l: '7天' },
  { k: '30', l: '30天' },
  { k: '90', l: '90天' },
  { k: 'all', l: '全部' },
];

const METRICS: { k: MetricKey; l: string }[] = [
  { k: 'sentences', l: '句数' },
  { k: 'accuracy', l: '准确率' },
  { k: 'sessions', l: '场次' },
];

interface Props {
  range: RangeKey;
  metric: MetricKey;
  onRange: (r: RangeKey) => void;
  onMetric: (m: MetricKey) => void;
}

export default function DataCommandBar({ range, metric, onRange, onMetric }: Props) {
  return (
    <div className={`${card.card} ${styles.root}`}>
      <div>
        <h1 className={styles.title}>学习数据</h1>
        <p className={styles.sub}>你的练习全貌 · 截至今天</p>
      </div>

      <div className={styles.controls}>
        <div className={styles.seg} role="group" aria-label="时间范围">
          {RANGES.map((r) => (
            <button
              key={r.k}
              type="button"
              className={`${styles.segBtn} ${range === r.k ? styles.segOn : ''}`}
              aria-pressed={range === r.k}
              onClick={() => onRange(r.k)}
            >
              {r.l}
            </button>
          ))}
        </div>
        <div className={`${styles.seg} ${styles.metric}`} role="group" aria-label="趋势指标">
          {METRICS.map((m) => (
            <button
              key={m.k}
              type="button"
              className={`${styles.segBtn} ${metric === m.k ? styles.segOn : ''}`}
              aria-pressed={metric === m.k}
              onClick={() => onMetric(m.k)}
            >
              {m.l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
