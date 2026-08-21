'use client';

/**
 * AchievementsSection — 等级灯牌 + 7 大 tier 进度 + 完整成就墙。
 *
 * 视觉布局(从上到下):
 *   1. Header(eyebrow + 标题)
 *   2. levelSection(大灯牌 + levelTitle + XP info + 进度条 + 下一级预览 + 7 tier 缩略条)
 *   3. AchievementWall(5 tracks × 13 徽章,3 档视觉:已完成/有进度/没进度)
 *
 * level 与 achievements 两个 model 在此处派生一次,共享给下游。
 */

import { useMemo, useState } from 'react';
import { DashboardSnapshot } from '../../api';
import {
  generateLevelInfo,
  TIERS,
  tierForLevel,
  type TierDef,
  xpForLevel,
} from '../level';
import { deriveAchievements } from './achievements';
import LevelEmblem from '../LevelEmblem';
import AchievementWall from './AchievementWall';
import styles from './AchievementsSection.module.css';

function fmtXp(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${v}`;
}

export default function AchievementsSection({ snapshot }: { snapshot: DashboardSnapshot }) {
  const lifetime = snapshot.lifetime ?? null;
  const level = useMemo(
    () =>
      generateLevelInfo({
        totalCorrect: lifetime?.total_correct,
        totalSentences: lifetime?.total_sentences,
        accuracy: lifetime?.accuracy,
      }),
    [lifetime?.total_correct, lifetime?.total_sentences, lifetime?.accuracy],
  );
  const achievements = useMemo(() => deriveAchievements(snapshot), [snapshot]);
  const currentTier = level.tier;
  const nextLevel = level.capped ? level.level : Math.min(100, level.level + 1);
  const xpAtCurrent = xpForLevel(level.level);
  const xpAtNext = xpForLevel(nextLevel);
  const nextTierForPreview: TierDef | null = level.capped
    ? null
    : tierForLevel(nextLevel) === currentTier
      ? null
      : tierForLevel(nextLevel);

  // 7 大 tier 缩略条 hover 状态 — 鼠标 hover tier 灯牌时显示该 tier
  // 真实激活色(去掉 locked 灰度),作为"目标预览"。当前 tier 不可 hover
  // (已经是激活色),已通过 tier 不再需要预览。
  const [hoveredTier, setHoveredTier] = useState<number | null>(null);

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>学习成就</p>
          <h1 className={styles.title}>你的等级和成就</h1>
        </div>
      </header>

      {/* ── 主轨:等级卡片(大灯牌 + 进度 + 下一级预览) ── */}
      <section className={styles.levelSection} aria-label="等级">
        <div className={styles.levelMain}>
          <div className={styles.levelEmblemWrap}>
            <LevelEmblem
              level={level.level}
              state="current"
              size={96}
              ariaLabel={`第 ${level.level} 级 ${currentTier.name}`}
            />
          </div>
          <div className={styles.levelMeta}>
            <h2 className={styles.levelTitle}>
              <span className={styles.levelNum}>Lv {level.level}</span>
              <span className={styles.levelTier}>{currentTier.name}</span>
              <span className={styles.levelTierBlurb}>· {currentTier.blurb}</span>
            </h2>
            <p className={styles.levelSub}>
              答对 1 句 +1 XP · 当前 XP <strong>{fmtXp(level.xp)}</strong>
              {level.capped ? (
                <span> · 已是最高级 <strong>Lv 100</strong></span>
              ) : (
                <>
                  {' '}· 升下一级还差 <strong>{fmtXp(level.toNextXp)}</strong> XP
                  {' '}(本级 <strong>{level.costForNextLevel}</strong> XP)
                </>
              )}
            </p>

            {/* 当前等级进度条 */}
            <div className={styles.levelProgress} aria-hidden>
              <div
                className={styles.levelProgressFill}
                style={{ width: `${level.pct}%` }}
              />
            </div>
            <p className={styles.levelProgressMeta}>
              Lv {level.level} → Lv {nextLevel} ·{' '}
              {fmtXp(xpAtCurrent)} / {fmtXp(xpAtNext)} XP · {level.pct}%
            </p>
          </div>

          {/* 下一级预览(如换 tier 显示,否则单卡片) */}
          {nextLevel > level.level && !level.capped ? (
            <div className={styles.nextPreview} aria-label="下一级预览">
              <p className={styles.nextPreviewLabel}>下一级</p>
              <LevelEmblem
                level={nextLevel}
                state="locked"
                size={44}
                ariaLabel={`第 ${nextLevel} 级 ${tierForLevel(nextLevel).name}`}
              />
              <p className={styles.nextPreviewText}>
                <strong>Lv {nextLevel}</strong> · {tierForLevel(nextLevel).name}
                {nextTierForPreview ? (
                  <span className={styles.nextPreviewBlurb}>
                    · 升入「{nextTierForPreview.name}」,开启新 tier
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
        </div>

        {/* ── 7 大 tier 缩略条 ── */}
        <div className={styles.tierStrip} role="list" aria-label="7 大 tier 进度">
          {TIERS.map((t) => {
            const isCurrent = t.index === currentTier.index;
            const isPast = currentTier.index > t.index;
            const inTier = Math.max(
              0,
              Math.min(t.levelEnd - t.levelStart + 1, level.level - t.levelStart + (isCurrent ? 1 : 0)),
            );
            const total = t.levelEnd - t.levelStart + 1;
            const fillPct = isPast ? 100 : isCurrent ? (inTier / total) * 100 : 0;
            // hover 状态:未达到的 tier,鼠标悬停时显示激活色(下一级预览)
            const showPreview = !isCurrent && !isPast && hoveredTier === t.index;
            return (
              <div
                key={t.index}
                role="listitem"
                className={[
                  styles.tierCell,
                  styles[`tierCell_${t.accent}`],
                  isCurrent ? styles.tierCellCurrent : '',
                  isPast ? styles.tierCellPast : '',
                  showPreview ? styles.tierCellPreview : '',
                ].join(' ').trim()}
                aria-label={`${t.name} ${t.levelStart}-${t.levelEnd} 级`}
                onMouseEnter={() => setHoveredTier(t.index)}
                onMouseLeave={() =>
                  setHoveredTier((curr) => (curr === t.index ? null : curr))
                }
              >
                <LevelEmblem
                  level={isPast ? t.levelEnd : isCurrent ? level.level : t.levelStart}
                  state={isPast ? 'passed' : isCurrent ? 'current' : 'locked'}
                  size={28}
                  forceActive={showPreview}
                />
                <div className={styles.tierCellMeta}>
                  <span className={styles.tierCellName}>{t.name}</span>
                  <span className={styles.tierCellRange}>
                    L{t.levelStart}–{t.levelEnd}
                  </span>
                </div>
                <div className={styles.tierCellBar} aria-hidden>
                  <div className={styles.tierCellBarFill} style={{ width: `${fillPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 支轨:成就墙(完整 5 tracks × 13 徽章,3 档视觉分级) ── */}
      <AchievementWall model={achievements} />
    </div>
  );
}
