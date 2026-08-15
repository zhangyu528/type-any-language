'use client';

/**
 * AchievementWall — Tier C momentum element for the overview.
 *
 * Derives a small set of achievement badges purely from the existing
 * GET /api/dashboard snapshot (no new backend fields beyond the
 * already-added preferred_hour). Each badge shows earned/locked state;
 * locked badges display how close the user is. Below the grid, a single
 * "next badge" progress bar points at the closest-to-unlocking badge —
 * the highest-leverage motivation signal (Tier D, selected).
 *
 * It is a pure presentational shell: page.tsx hydrates the snapshot and
 * passes it down. No data fetching here.
 */

import { useEffect, useMemo, useState } from 'react';
import { DashboardSnapshot } from '../../api';
import styles from './AchievementWall.module.css';

interface BadgeDef {
  id: string;
  label: string;
  /** sub-label shown when earned */
  earnedSub: string;
  /** sub-label shown when locked; receives current/target */
  lockedSub: (current: number, target: number) => string;
  current: number;
  target: number;
  unit: string;
  earned: boolean;
}

const SEEN_KEY = 'tal.seenBadges.v1';

function clampPct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export default function AchievementWall({ snapshot }: { snapshot: DashboardSnapshot }) {
  const model = useMemo(() => {
    // ---- derive base metrics from the snapshot (all client-side) ----
    const nonFuture = snapshot.calendar.filter((d) => !d.is_future);
    const totalSentences = nonFuture.reduce((s, d) => s + d.sentences_count, 0);
    const daysPracticed = nonFuture.filter((d) => d.sentences_count > 0).length;

    const created = new Date(snapshot.user.created_at);
    const tenureDays = !isNaN(created.getTime())
      ? Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000))
      : 0;

    const longest = snapshot.streak.longest;
    const maxStreak = Math.max(snapshot.streak.current, longest);

    // Accuracy: tolerate demo scale (0–100) AND backend scale (0–1).
    const accStat = snapshot.progress?.accuracy_7d ?? snapshot.progress?.accuracy ?? null;
    let accuracyPct = 0;
    if (accStat && typeof accStat.value === 'number') {
      accuracyPct = accStat.value > 1.5 ? accStat.value : accStat.value * 100;
    }

    const badges: BadgeDef[] = [
      {
        id: 'first',
        label: '初心者',
        earnedSub: '首句已完成',
        lockedSub: (c) => `还差 ${Math.max(0, 1 - c)} 天`,
        current: daysPracticed,
        target: 1,
        unit: '天',
        earned: daysPracticed >= 1,
      },
      {
        id: 'week',
        label: '七日打卡',
        earnedSub: '连续 7 天',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
        current: maxStreak,
        target: 7,
        unit: '天',
        earned: maxStreak >= 7,
      },
      {
        id: 'hundred',
        label: '百句达成',
        earnedSub: '累计 100 句',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 句`,
        current: totalSentences,
        target: 100,
        unit: '句',
        earned: totalSentences >= 100,
      },
      {
        id: 'month',
        label: '月度达标',
        earnedSub: '本月已达成',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
        current: snapshot.monthly_goal.current,
        target: snapshot.monthly_goal.target > 0 ? snapshot.monthly_goal.target : 1,
        unit: '天',
        earned: snapshot.monthly_goal.achieved,
      },
      {
        id: 'loyal',
        label: '忠诚学子',
        earnedSub: '学习满 30 天',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
        current: tenureDays,
        target: 30,
        unit: '天',
        earned: tenureDays >= 30,
      },
      {
        id: 'master',
        label: '连击大师',
        earnedSub: '最长 30 天',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
        current: longest,
        target: 30,
        unit: '天',
        earned: longest >= 30,
      },
      {
        id: 'sharp',
        label: '精确射手',
        earnedSub: '准确率 90%+',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)}%`,
        current: Math.round(accuracyPct),
        target: 90,
        unit: '%',
        earned: accuracyPct >= 90,
      },
      {
        id: 'diligent',
        label: '勤奋学徒',
        earnedSub: '练习满 20 天',
        lockedSub: (_c, t) => `还差 ${Math.max(0, t - _c)} 天`,
        current: daysPracticed,
        target: 20,
        unit: '天',
        earned: daysPracticed >= 20,
      },
    ];

    const earnedCount = badges.filter((b) => b.earned).length;

    // Next badge = the locked one closest to unlocking (highest %).
    const locked = badges.filter((b) => !b.earned);
    let next: BadgeDef | null = null;
    let nextPct = -1;
    for (const b of locked) {
      const p = clampPct(b.current, b.target);
      if (p > nextPct) {
        nextPct = p;
        next = b;
      }
    }

    return { badges, earnedCount, next, nextPct };
  }, [snapshot]);

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
