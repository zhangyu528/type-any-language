'use client';

/**
 * AchievementWall — 支线成就完整网格(频次 / 准确 / 连击 / 量 / 特殊)。
 *
 * 视觉层次:
 *   1. 5 个 track 各自一个分组,track header 显示进度条 + X/Y
 *   2. 每个 track 默认折叠(已完成的)/展开(进行中的)
 *   3. 每个 badge 卡片:环形进度 + 名字 + X/Y
 *   4. 优先级排序:下一个最接近 → 已解锁 → 未解锁
 *   5. 下一个最接近:琥珀边框 + 微抬升
 *
 * 由 AchievementsSection 派生 model 后传入,本组件纯展示。
 * 紧凑摘要条见 ./AchievementSummary.tsx。
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AchievementsModel, BadgeAccent, AchievementTrack, BadgeDef } from './achievements';
import BadgeRing from './BadgeRing';
import badgeStyles from './BadgeEmblem.module.css';
import styles from './AchievementWall.module.css';

/** 5 条支线对应的徽章 accent 视觉摘要色,用于 track header 装饰 + 新解锁 toast。
 * 取每条支线第一枚徽章的主色作为视觉锚点。 */
export const TRACK_ACCENT: Record<AchievementTrack, BadgeAccent> = {
  frequency: 'mint',
  accuracy: 'coral',
  streak: 'amber',
  volume: 'lavender',
  special: 'indigo',
};

const SEEN_KEY = 'tal.seenBadges.v1';
const COLLAPSED_KEY = 'tal.collapsedTracks.v1';

function clampPct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

/** 把 track 内的 badges 按"展示优先级"排序:
 *  - 已解锁(高亮)优先,按 target 升序(低门槛成就先看到)
 *  - 进行中(有进度)次之,按进度降序(最接近解锁的靠前)
 *  - 未开始(0% 进度)最后,按 target 升序(易达成的靠前)
 * 三档视觉权重,跟卡片高亮 / 中等 / 降级 一一对应。 */
function sortBadgesForTrack(badges: BadgeDef[]): BadgeDef[] {
  function tier(b: BadgeDef): number {
    if (b.earned) return 0;
    if (b.current > 0) return 1;
    return 2;
  }
  return [...badges].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    // 同档内:已完成按 target 升序(易得先看),其他按进度降序(更接近解锁靠前)
    if (a.earned && b.earned) return a.target - b.target;
    return clampPct(b.current, b.target) - clampPct(a.current, b.target);
  });
}

function readCollapsedFromStorage(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
  } catch {
    /* 隐私模式静默 */
  }
  return {};
}

function writeCollapsedToStorage(state: Record<string, boolean>) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式静默 */
  }
}

export default function AchievementWall({ model }: { model: AchievementsModel }) {
  // 庆祝系统:进入页面时对比"已见徽章",若本会话有新解锁则 toast + 脉冲。
  const earnedIds = useMemo(
    () => model.tracks.flatMap((t) => t.badges).filter((b) => b.earned).map((b) => b.id),
    [model],
  );
  const [fresh, setFresh] = useState<string[]>([]);
  const [toastOn, setToastOn] = useState(false);

  // track 折叠状态:已全部解锁的 track 默认折叠(节省空间),
  // 进行中的 track 默认展开。持久化到 localStorage。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const t of model.tracks) {
      const allDone = t.badges.every((b) => b.earned);
      initial[t.track] = allDone;
    }
    return initial;
  });

  useEffect(() => {
    let saved: Record<string, boolean> = {};
    try {
      saved = readCollapsedFromStorage();
    } catch {
      /* SSR / 隐私模式 */
    }
    // merge: 用户主动折叠/展开的 track 优先,其余保持 derived 初始值(全部解锁折叠)
    setCollapsed((curr) => {
      const merged: Record<string, boolean> = { ...curr };
      for (const [k, v] of Object.entries(saved)) {
        if (typeof v === 'boolean') merged[k] = v;
      }
      return merged;
    });
  }, []);

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
    .map((id) => model.tracks.flatMap((t) => t.badges).find((b) => b.id === id)?.label)
    .filter((v): v is string => Boolean(v));

  const toggleTrack = (track: AchievementTrack) => {
    setCollapsed((curr) => {
      const next = { ...curr, [track]: !curr[track] };
      writeCollapsedToStorage(next);
      return next;
    });
  };

  // 下一个最接近属于哪个 track — 现在不再用,sort 只按完成/进行中/未开始 3 档分
  return (
    <>
      {fresh.length > 0 ? (
        <div
          className={`${styles.toast} ${toastOn ? styles.toastOn : ''}`}
          role="status"
          aria-live="polite"
        >
          解锁新徽章:{freshLabels.join('、')}
        </div>
      ) : null}
      <section className={styles.root} aria-label="支线成就">
        <header className={styles.head}>
          <p className={styles.title}>支线成就</p>
          <span className={styles.count}>
            {model.earnedCount} / {model.totalCount} 已解锁
          </span>
        </header>

        {model.tracks.map((track) => {
          const trackAccent = TRACK_ACCENT[track.track];
          const earnedInTrack = track.badges.filter((b) => b.earned).length;
          const totalInTrack = track.badges.length;
          const trackPct = totalInTrack === 0 ? 0 : (earnedInTrack / totalInTrack) * 100;
          const isCollapsed = collapsed[track.track] ?? false;
          const sortedBadges = sortBadgesForTrack(track.badges);
          return (
            <div key={track.track} className={styles.track}>
              <button
                type="button"
                className={[
                  styles.trackHead,
                  badgeStyles[`accent_${trackAccent}`],
                ].join(' ').trim()}
                onClick={() => toggleTrack(track.track)}
                aria-expanded={!isCollapsed}
                aria-controls={`track-panel-${track.track}`}
              >
                <span className={styles.trackChip} aria-hidden />
                <span className={styles.trackTitle}>{track.title}</span>
                <span className={styles.trackCount}>
                  {earnedInTrack}/{totalInTrack}
                </span>
                <span className={styles.trackBar} aria-hidden>
                  <span
                    className={styles.trackBarFill}
                    style={{ width: `${trackPct}%` }}
                  />
                </span>
                <span
                  className={`${styles.trackChevron} ${isCollapsed ? styles.trackChevronCollapsed : ''}`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>
              {!isCollapsed ? (
                <div
                  className={styles.grid}
                  id={`track-panel-${track.track}`}
                  role="list"
                >
                  {sortedBadges.map((b) => {
                    const pct = clampPct(b.current, b.target);
                    const accentClass = badgeStyles[`accent_${b.accent}`];
                    const isFresh = fresh.includes(b.id);
                    return (
                      <div
                        key={b.id}
                        role="listitem"
                        className={[
                          styles.badge,
                          accentClass,
                          b.earned ? styles.earned : styles.locked,
                          isFresh ? styles.pulse : '',
                        ].join(' ').trim()}
                        style={
                          isFresh
                            ? ({ '--pulse-color': 'var(--badge-color)' } as CSSProperties)
                            : undefined
                        }
                        aria-label={`${b.label} · ${b.current}/${b.target}${b.unit}`}
                      >
                        <BadgeRing
                          shape={b.shape}
                          icon={b.icon}
                          accent={b.accent}
                          earned={b.earned}
                          pct={pct}
                          size={56}
                          className={styles.badgeRing}
                        />
                        <div className={styles.badgeBody}>
                          <span className={styles.label}>{b.label}</span>
                          <span className={styles.progressText}>
                            {b.current} / {b.target} {b.unit}
                          </span>
                        </div>
                        {b.earned ? (
                          <span className={styles.checkBadge} aria-label="已解锁">
                            ✓
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    </>
  );
}
