'use client';

/**
 * OverviewSection — 概览（方向 B：个人学习日报）。
 *
 * 信息架构：顶部 Hero（问候 + 连击胶囊「唯一连击源」+ 本月目标迷你条）
 * → 双栏主体（左=行动+动量，右=洞察+进度）→ 成就墙（通栏）。
 *
 * 去重：连击只在 Hero 胶囊 + 连击动量出现；月目标只在 Hero 迷你条 +
 * 进度叙事出现；准确率只在薄弱洞察 / 本周一眼出现，成就墙不再重复数字。
 * 「本周一眼」已移除重复的"连续天数"。
 *
 * 首跑态：无任何练习记录时整页切换为 FirstRunGuide。
 *
 * 本组件只做展示拼装，数据来自 page.tsx 传入的 snapshot + catalog。
 */

import { useMemo } from 'react';
import { Catalog, DashboardSnapshot } from '../../api';
import AnimatedContent from '@/components/AnimatedContent';
import BorderGlow from '@/components/BorderGlow';
import GreetingBar from '../GreetingBar';
import ContinueCard from '../ContinueCard';
import DailyGoal from '../DailyGoal';
import StreakMomentum from './StreakMomentum';
import AchievementWall from './AchievementWall';
import TodaySuggestion from './TodaySuggestion';
import ProgressNarrative from './ProgressNarrative';
import WeaknessInsight from './WeaknessInsight';
import FirstRunGuide from './FirstRunGuide';
import styles from './OverviewSection.module.css';

interface OverviewSectionProps {
  snapshot: DashboardSnapshot;
  /** Eager-loaded catalog (page.tsx). Drives the quick-launch chips. */
  catalog?: Catalog | null;
  onResume: () => void;
  onPickLib: () => void;
  /** Jump straight into a lib's drill (used by the quick-launch chips). */
  onStartLib: (libId: string) => void;
}

export default function OverviewSection({
  snapshot,
  catalog,
  onResume,
  onPickLib,
  onStartLib,
}: OverviewSectionProps) {
  // 最近词库（persisted in prefs.libId），供建议/快启/首跑态读取。
  const recentId =
    typeof window !== 'undefined' ? window.localStorage.getItem('prefs.libId') : null;
  const recentLib = useMemo(
    () => (recentId && catalog ? catalog.libs.find((l) => l.id === recentId) ?? null : null),
    [recentId, catalog],
  );

  // 本周一眼：末 7 天聚合 + progress KPI 的周环比 delta（已不含连续天数）。
  const weekGlance = useMemo(() => {
    const days = snapshot.calendar.slice(-7).filter((d) => !d.is_future);
    const sentences = days.reduce((sum, d) => sum + d.sentences_count, 0);
    const correct = days.reduce(
      (sum, d) => sum + (d.accuracy != null ? Math.round(d.accuracy * d.sentences_count) : 0),
      0,
    );
    const accuracy = sentences > 0 ? Math.round((correct / sentences) * 100) : null;
    return {
      sentences,
      accuracy,
      newWords: snapshot.progress?.new_words ?? null,
      acc7: snapshot.progress?.accuracy_7d ?? null,
    };
  }, [snapshot.calendar, snapshot.progress]);

  // 常用词库快启：最近词库置顶，其余补足，最多 3 个。
  const chips = useMemo(() => {
    if (!catalog) return [];
    const ids = recentId
      ? [recentId, ...catalog.libs.map((l) => l.id).filter((id) => id !== recentId)]
      : catalog.libs.map((l) => l.id);
    const byId = new Map(catalog.libs.map((l) => [l.id, l]));
    return ids
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .slice(0, 3);
  }, [catalog, recentId]);

  const isFirstRun = snapshot.continue.session_id === null && weekGlance.sentences === 0;

  // 首跑 / 空状态：整页切换为引导态。
  if (isFirstRun) {
    return (
      <FirstRunGuide
        catalog={catalog}
        recentLibId={recentId}
        recentLibName={recentLib?.name ?? null}
        onStartLib={onStartLib}
        onPickLib={onPickLib}
      />
    );
  }

  return (
    <>
      <header className={styles.header}>
        <GreetingBar
          user={snapshot.user}
          streak={snapshot.streak}
          monthlyGoal={snapshot.monthly_goal}
          preferredHour={snapshot.preferred_hour}
        />
      </header>

      <div className={styles.layout}>
        {/* 左列：行动 + 动量 */}
        <div className={styles.colMain}>
          <section className={styles.today} aria-label="今日练习">
            <p className={styles.todayLabel}>今日</p>
            <div className={styles.panel}>
              <div className={`${styles.glass} ${styles.continue}`}>
                <BorderGlow
                  className={styles.continueGlow}
                  glowColor="143, 203, 240"
                  glowRadius={40}
                  glowIntensity={1.0}
                >
                  <ContinueCard state={snapshot.continue} onResume={onResume} onPickLib={onPickLib} />
                </BorderGlow>
              </div>
              <div className={`${styles.glass} ${styles.goal}`}>
                <DailyGoal state={snapshot.daily_goal} />
              </div>
            </div>
          </section>

          <AnimatedContent distance={20} direction="vertical" delay={0} className={styles.block}>
            <StreakMomentum
              streak={snapshot.streak}
              calendar={snapshot.calendar}
              yearMonth={snapshot.monthly_goal.year_month}
            />
          </AnimatedContent>

          {chips.length > 0 ? (
            <AnimatedContent distance={20} direction="vertical" delay={80 / 1000} className={styles.block}>
              <p className={styles.quickLaunchLabel}>常用词库</p>
              <div className={styles.chips}>
                {chips.map((lib) => {
                  const isCurrent = lib.id === recentId;
                  return (
                    <button
                      key={lib.id}
                      type="button"
                      className={`${styles.chip} ${isCurrent ? styles.chipCurrent : ''}`}
                      onClick={() => onStartLib(lib.id)}
                    >
                      {lib.name}
                      {isCurrent ? <span className={styles.chipBadge}>当前</span> : null}
                    </button>
                  );
                })}
              </div>
            </AnimatedContent>
          ) : null}
        </div>

        {/* 右列：洞察 + 进度 */}
        <div className={styles.colSide}>
          <AnimatedContent distance={20} direction="vertical" delay={40 / 1000} className={styles.block}>
            <TodaySuggestion
              preferredHour={snapshot.preferred_hour}
              streak={snapshot.streak}
              dailyGoal={snapshot.daily_goal}
              recentLibId={recentId}
              recentLibName={recentLib?.name ?? null}
              onStartLib={onStartLib}
              onPickLib={onPickLib}
            />
          </AnimatedContent>

          <AnimatedContent distance={20} direction="vertical" delay={80 / 1000} className={styles.block}>
            <ProgressNarrative
              userId={snapshot.user.id}
              catalog={catalog}
              monthlyGoal={snapshot.monthly_goal}
            />
          </AnimatedContent>

          <AnimatedContent distance={20} direction="vertical" delay={120 / 1000} className={styles.block}>
            <WeaknessInsight userId={snapshot.user.id} catalog={catalog} onStartLib={onStartLib} />
          </AnimatedContent>

          <AnimatedContent distance={20} direction="vertical" delay={160 / 1000} className={styles.block}>
            <div className={styles.weekGlanceText}>
              <span className={styles.glanceItem}>
                本周 <b className={styles.glanceNum}>{weekGlance.sentences}</b> 句
              </span>
              <span className={styles.glanceItem}>
                命中{' '}
                <b className={`${styles.glanceNum} ${styles.glanceHit}`}>
                  {weekGlance.accuracy != null ? `${weekGlance.accuracy}%` : '—'}
                </b>
                {weekGlance.acc7 && weekGlance.acc7.delta !== 0 ? (
                  <b className={styles.glanceDelta}>
                    {weekGlance.acc7.delta > 0 ? '▲' : '▼'}
                    {Math.abs(weekGlance.acc7.delta)}
                  </b>
                ) : null}
              </span>
              {weekGlance.newWords ? (
                <span className={styles.glanceItem}>
                  本周新词{' '}
                  <b className={styles.glanceNum}>+{weekGlance.newWords.value}</b>
                  {weekGlance.newWords.delta !== 0 ? (
                    <b className={styles.glanceDelta}>
                      {weekGlance.newWords.delta > 0 ? '▲' : '▼'}
                      {Math.abs(weekGlance.newWords.delta)}
                    </b>
                  ) : null}
                </span>
              ) : null}
            </div>
          </AnimatedContent>
        </div>
      </div>

      <AnimatedContent distance={20} delay={200 / 1000} direction="vertical" className={styles.achievement}>
        <AchievementWall snapshot={snapshot} />
      </AnimatedContent>
    </>
  );
}
