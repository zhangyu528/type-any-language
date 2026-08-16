'use client';

/**
 * AchievementsSection — 独立「成就」分区（方案 1：侧边栏 收藏 → 成就）。
 *
 * 把概览里的 AchievementWall 升级为整页：顶部一个终身大头统计条
 * （累计练习 / 练习天数 / 最长连击 / 终身准确率），下接成就墙徽章。
 * 数据全部来自 GET /api/dashboard 的 snapshot（streak + daily_activity
 * 终身汇总），无需新端点。
 */

import { useMemo } from 'react';
import { DashboardSnapshot } from '../../api';
import AchievementWall from './AchievementWall';
import styles from './AchievementsSection.module.css';

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

export default function AchievementsSection({ snapshot }: { snapshot: DashboardSnapshot }) {
  const lifetime = snapshot.lifetime ?? null;

  const headline = useMemo(
    () => [
      {
        label: '累计练习',
        value: lifetime ? `${lifetime.total_sentences}` : '0',
        unit: '句',
      },
      {
        label: '练习天数',
        value: lifetime ? `${lifetime.days_practiced}` : '0',
        unit: '天',
      },
      {
        label: '最长连击',
        value: `${snapshot.streak.longest}`,
        unit: '天',
      },
      {
        label: '终身准确率',
        value: fmtPct(lifetime?.accuracy),
        unit: '',
      },
    ],
    [lifetime, snapshot.streak.longest],
  );

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>学习成就</p>
          <h1 className={styles.title}>你的里程碑</h1>
          <p className={styles.subtitle}>
            由练习记录自动解锁——不必手动收藏，错得多的句子会被程序记下来变成薄弱点。
          </p>
        </div>
      </header>

      <div className={styles.stats}>
        {headline.map((s) => (
          <div key={s.label} className={styles.statCard}>
            <span className={styles.statValue}>
              {s.value}
              {s.unit ? <span className={styles.statUnit}>{s.unit}</span> : null}
            </span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      <AchievementWall snapshot={snapshot} />
    </div>
  );
}
