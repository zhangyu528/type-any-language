'use client';

import { useMemo } from 'react';
import { CalendarDay } from '../api';
import card from './card.module.css';
import styles from './HeatmapPanel.module.css';

interface Props {
  days: CalendarDay[] | null;
  onSelectDay?: (date: string) => void;
}

function level(sent: number): number {
  if (sent <= 0) return 0;
  if (sent < 10) return 1;
  if (sent < 20) return 2;
  if (sent < 35) return 3;
  return 4;
}

// Monday = 0 … Sunday = 6
function dowMonday(iso: string): number {
  const d = new Date(iso + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}

export default function HeatmapPanel({ days, onSelectDay }: Props) {
  const { cells, weeks, activeCount, total } = useMemo(() => {
    if (!days || days.length === 0) {
      return { cells: [], weeks: 0, activeCount: 0, total: 0 };
    }
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const pad = dowMonday(sorted[0].date);
    const totalDays = sorted.length;
    const weeks = Math.ceil((pad + totalDays) / 7);
    const cells: (CalendarDay | null)[] = [
      ...Array<null>(pad).fill(null),
      ...sorted,
    ];
    const activeCount = sorted.filter((d) => d.sentences_count > 0).length;
    return { cells, weeks, activeCount, total: totalDays };
  }, [days]);

  if (weeks === 0) {
    return (
      <div className={`${card.card} ${styles.root}`}>
        <div className={styles.chead}>
          <h2 className={styles.title}>练习节奏</h2>
        </div>
        <p className={styles.empty}>暂无节奏数据。</p>
      </div>
    );
  }

  return (
    <div className={`${card.card} ${styles.root}`}>
      <div className={styles.chead}>
        <h2 className={styles.title}>练习节奏</h2>
        <span className={styles.hint}>近 {weeks} 周</span>
      </div>
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}
      >
        {cells.map((d, i) =>
          d == null ? (
            <span key={`pad-${i}`} className={styles.cell} />
          ) : (
            <button
              key={d.date}
              type="button"
              className={`${styles.cell} ${styles[`l${level(d.sentences_count)}`]}${
                d.is_future ? ' ' + styles.future : ''
              }`}
              disabled={d.is_future}
              title={`${d.date} · ${d.sentences_count} 句`}
              onClick={() => !d.is_future && onSelectDay?.(d.date)}
            />
          ),
        )}
      </div>
      <div className={styles.pad}>
        <span>较早</span>
        <span className={styles.count}>
          {activeCount} / {total} 天有练习
        </span>
        <span>今天</span>
      </div>
    </div>
  );
}
