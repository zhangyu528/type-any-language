'use client';

import { useMemo } from 'react';
import { CalendarDay, DashboardSnapshot } from '../api';
import card from './card.module.css';
import styles from './InsightsRow.module.css';

interface Props {
  snapshot: DashboardSnapshot;
  current: CalendarDay[];
  previous: CalendarDay[];
  windowLen: number;
}

function avgAcc(days: CalendarDay[]): number | null {
  const ds = days.filter((d) => d.accuracy != null);
  if (!ds.length) return null;
  return ds.reduce((a, d) => a + (d.accuracy as number), 0) / ds.length;
}

function activeDays(days: CalendarDay[]): number {
  return days.filter((d) => d.sentences_count > 0).length;
}

const MILESTONES = [7, 14, 30, 60, 100];

export default function InsightsRow({ snapshot, current, previous, windowLen }: Props) {
  const insights = useMemo(() => {
    const out: { icon: string; text: React.ReactNode }[] = [];

    const streak = snapshot.streak?.current ?? 0;
    if (streak >= 1) {
      const next = MILESTONES.find((m) => m > streak) ?? streak + 30;
      out.push({
        icon: '🔥',
        text: (
          <>
            你已连续 <b>{streak}</b> 天打卡，再坚持 <b>{Math.max(1, next - streak)}</b> 天解锁「
            {next} 天坚持者」徽章。
          </>
        ),
      });
    }

    const curAcc = avgAcc(current);
    const prevAcc = avgAcc(previous);
    if (curAcc != null && prevAcc != null && Math.abs(curAcc - prevAcc) >= 0.005) {
      const up = curAcc >= prevAcc;
      const diff = Math.round(Math.abs(curAcc - prevAcc) * 100);
      out.push({
        icon: up ? '📈' : '📉',
        text: (
          <>
            近 {windowLen} 天准确率较上一周期 <b>{up ? '提升' : '下降'} {diff}%</b>。
          </>
        ),
      });
    }

    const hour = snapshot.preferred_hour;
    if (hour != null) {
      const hh = String(hour).padStart(2, '0');
      out.push({
        icon: '⏰',
        text: (
          <>
            你通常在 <b>{hh}:00</b> 练习，这是你正确率最高效的时段。
          </>
        ),
      });
    }

    const act = activeDays(current);
    if (windowLen > 0) {
      out.push({
        icon: '🗓️',
        text: (
          <>
            本期 <b>{act}</b> / {windowLen} 天有练习，保持节奏就能稳步积累。
          </>
        ),
      });
    }

    return out;
  }, [snapshot, current, previous, windowLen]);

  if (insights.length === 0) return null;

  return (
    <div className={styles.root}>
      {insights.map((it, i) => (
        <div key={i} className={`${card.card} ${styles.ins}`}>
          <span className={styles.icon} aria-hidden>
            {it.icon}
          </span>
          <p className={styles.text}>{it.text}</p>
        </div>
      ))}
    </div>
  );
}
