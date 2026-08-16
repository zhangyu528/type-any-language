'use client';

/**
 * AchievementWall — Tier C momentum element for the overview / 成就页。
 *
 * 徽章派生逻辑已抽离到 ./achievements（deriveAchievements），本组件只负责
 * 把模型渲染成徽章网格 + 「下个徽章」进度条，并处理「新解锁」庆祝 toast。
 *
 * 它是纯展示壳：page.tsx 注入 snapshot，本组件 hydrate 后传给 deriveAchievements。
 * 不在此做数据请求。
 */

import { useEffect, useMemo, useState } from 'react';
import { DashboardSnapshot } from '../../api';
import { deriveAchievements } from './achievements';
import styles from './AchievementWall.module.css';

const SEEN_KEY = 'tal.seenBadges.v1';

export default function AchievementWall({ snapshot }: { snapshot: DashboardSnapshot }) {
  const model = useMemo(() => deriveAchievements(snapshot), [snapshot]);

  // 庆祝系统：进入概览时对比"已见徽章"，若本会话有新解锁则 toast + 脉冲。
  const earnedIds = useMemo(
    () => model.badges.filter((b) => b.earned).map((b) => b.id),
    [model],
  );
  const [fresh, setFresh] = useState<string[]>([]);
  const [toastOn, setToastOn] = useState(false);

  useEffect(() => {
    let seen: string[] = [];
    try {
      seen = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]');
    } catch {
      seen = [];
    }
    const newly = earnedIds.filter((id) => !seen.includes(id));
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(earnedIds));
    } catch {
      /* 隐私模式静默 */
    }
    if (newly.length > 0) {
      setFresh(newly);
      setToastOn(true);
      const t = setTimeout(() => setToastOn(false), 4500);
      return () => clearTimeout(t);
    }
    return undefined;
    // 仅挂载时检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const freshLabels = fresh
    .map((id) => model.badges.find((b) => b.id === id)?.label)
    .filter((v): v is string => Boolean(v));

  return (
    <>
      {fresh.length > 0 ? (
        <div
          className={`${styles.toast} ${toastOn ? styles.toastOn : ''}`}
          role="status"
          aria-live="polite"
        >
          解锁新徽章：{freshLabels.join('、')}
        </div>
      ) : null}
      <section className={styles.root} aria-label="成就">
      <div className={styles.head}>
        <p className={styles.title}>成就</p>
        <span className={styles.count}>
          {model.earnedCount} / {model.badges.length} 已解锁
        </span>
      </div>

      <div className={styles.grid}>
        {model.badges.map((b) => (
          <div
            key={b.id}
            className={`${styles.badge} ${b.earned ? styles.earned : styles.locked} ${
              fresh.includes(b.id) ? styles.pulse : ''
            }`}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>{b.label}</span>
            <span className={styles.sub}>
              {b.earned ? b.earnedSub : b.lockedSub(b.current, b.target)}
            </span>
          </div>
        ))}
      </div>

      {model.next ? (
        <div className={styles.next}>
          <div className={styles.nextHead}>
            <span className={styles.nextLabel}>下个徽章</span>
            <span className={styles.nextText}>
              {model.next.label} · 还差 {Math.max(0, model.next.target - model.next.current)}
              {model.next.unit}
            </span>
          </div>
          <div className={styles.nextTrack}>
            <div className={styles.nextFill} style={{ width: `${model.nextPct}%` }} />
          </div>
        </div>
      ) : (
        <p className={styles.allDone}>全部解锁 · 你已是语言大师</p>
      )}
    </section>
    </>
  );
}
