'use client';

/**
 * OverviewSection — 概览（方向 B：个人学习日报）。
 *
 * 信息架构：顶部 Hero（问候 + 连击胶囊「唯一连击源」+ 本月目标迷你条）
 * → 双栏主体（左=行动+动量，右=洞察+进度）→ 成就墙（通栏）。
 *
 * 去重：连击只在 Hero 胶囊 + 连击动量出现；月目标只在 Hero 迷你条出现；
 * 习惯时刻只在 TodaySuggestion 出现；准确率只在薄弱洞察 / 本周一眼出现，
 * 成就墙不再重复数字。
 * 「本周一眼」已移除重复的"连续天数"。
 *
 * 首跑态：无任何练习记录时整页切换为 FirstRunGuide。
 *
 * 本组件只做展示拼装，数据来自 page.tsx 传入的 snapshot + catalog。
 */

import { useMemo } from 'react';
import { Catalog, DashboardSnapshot } from '../../api';
import AnimatedContent from '@/components/AnimatedContent';
import GreetingBar from '../GreetingBar';
import ContinueCard from '../ContinueCard';
import DailyGoal from '../DailyGoal';
import StreakMomentum from './StreakMomentum';
import AchievementWall from './AchievementWall';
import TodaySuggestion from './TodaySuggestion';
import ProgressNarrative from './ProgressNarrative';
import WeaknessInsight from './WeaknessInsight';
import FirstRunGuide from './FirstRunGuide';
import QuickNav from './QuickNav';
import styles from './OverviewSection.module.css';
import { DashboardSection } from '../DashboardNav';

interface OverviewSectionProps {
  snapshot: DashboardSnapshot;
  /** Eager-loaded catalog (page.tsx). Drives the quick-launch chips. */
  catalog?: Catalog | null;
  onResume: () => void;
  onPickLib: () => void;
  /** Jump straight into a lib's drill (used by the quick-launch chips). */
  onStartLib: (libId: string) => void;
  /** 快速入口导航（课程/数据/收藏/复习 → 对应分区）。 */
  onNavigate: (section: DashboardSection) => void;
  /** 收藏句数（驱动快速入口的收藏卡）。 */
  collectionCount: number;
  /** 用户已选课程（我的课程）的 lib id 列表，驱动主页「我的课程」块。 */
  enrolledLibIds?: string[];
}

export default function OverviewSection({
  snapshot,
  catalog,
  onResume,
  onPickLib,
  onStartLib,
  onNavigate,
  collectionCount,
  enrolledLibIds,
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

  // 我的课程：从已选课程集合过滤出 lib，最多 4 张。
  const myCourseLibs = useMemo(() => {
    if (!catalog || !enrolledLibIds || enrolledLibIds.length === 0) return [];
    const byId = new Map(catalog.libs.map((l) => [l.id, l]));
    return enrolledLibIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .slice(0, 4);
  }, [catalog, enrolledLibIds]);

  // 首跑态：从未练习过。
  // 用后端的终身信号 has_any_activity（按 user_id 统计 daily_activity 是否有
  // 任何记录），它不依赖 35 天 calendar 窗口、也不依赖 user_streaks 回滚——
  // 否则 streak 功能上线前的老账号（缺 user_streaks 行 → streak.longest 恒为 0）
  // 会被错误切到欢迎引导。
  // 叠加无进行中会话：避免"第一次练习进行途中"误判为首跑。
  const isFirstRun =
    snapshot.continue.session_id === null && !snapshot.has_any_activity;

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
        />
      </header>

      <QuickNav
        snapshot={snapshot}
        collectionCount={collectionCount}
        reviewDue={snapshot.review_due_count ?? 0}
        onNavigate={onNavigate}
      />

      <div className={styles.bento}>
        {/* 行动区：继续 / 今日目标 / 连击动量 + 常用词库快启 */}
        <p className={styles.zoneLabel}>行动</p>

        <AnimatedContent distance={20} direction="vertical" delay={0} className={`${styles.bentoCell} ${styles.span6}`}>
          <div className={styles.cardGlass}>
            <ContinueCard state={snapshot.continue} onResume={onResume} onPickLib={onPickLib} />
          </div>
        </AnimatedContent>

        <AnimatedContent distance={20} direction="vertical" delay={60 / 1000} className={`${styles.bentoCell} ${styles.span3}`}>
          <div className={styles.cardGlass}>
            <DailyGoal state={snapshot.daily_goal} />
          </div>
        </AnimatedContent>

        <AnimatedContent distance={20} direction="vertical" delay={120 / 1000} className={`${styles.bentoCell} ${styles.span3}`}>
          <StreakMomentum
            streak={snapshot.streak}
            calendar={snapshot.calendar}
            yearMonth={snapshot.monthly_goal.year_month}
          />
        </AnimatedContent>

        {myCourseLibs.length > 0 ? (
          <AnimatedContent distance={20} direction="vertical" delay={160 / 1000} className={`${styles.bentoCell} ${styles.span12}`}>
            <div className={styles.quickLaunchBlock}>
              <p className={styles.quickLaunchLabel}>我的课程</p>
              <div className={styles.chips}>
                {myCourseLibs.map((lib) => (
                  <button
                    key={lib.id}
                    type="button"
                    className={styles.chip}
                    onClick={() => onStartLib(lib.id)}
                  >
                    {lib.name}
                  </button>
                ))}
              </div>
            </div>
          </AnimatedContent>
        ) : (
          <AnimatedContent distance={20} direction="vertical" delay={160 / 1000} className={`${styles.bentoCell} ${styles.span12}`}>
            <div className={styles.quickLaunchBlock}>
              <p className={styles.quickLaunchLabel}>我的课程</p>
              <button
                type="button"
                className={styles.quickLaunchEmpty}
                onClick={() => onNavigate('practice')}
              >
                还没有课程，去添加 →
              </button>
            </div>
          </AnimatedContent>
        )}

        {/* 洞察区：今日建议 / 进度叙事 / 薄弱洞察 */}
        <p className={styles.zoneLabel}>洞察</p>

        <AnimatedContent distance={20} direction="vertical" delay={40 / 1000} className={`${styles.bentoCell} ${styles.span4}`}>
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

        <AnimatedContent distance={20} direction="vertical" delay={80 / 1000} className={`${styles.bentoCell} ${styles.span4}`}>
          <ProgressNarrative userId={snapshot.user.id} catalog={catalog} />
        </AnimatedContent>

        <AnimatedContent distance={20} direction="vertical" delay={120 / 1000} className={`${styles.bentoCell} ${styles.span4}`}>
          <WeaknessInsight userId={snapshot.user.id} catalog={catalog} onStartLib={onStartLib} />
        </AnimatedContent>

        {/* 本周 KPI 条 */}
        <AnimatedContent distance={20} direction="vertical" delay={160 / 1000} className={`${styles.bentoCell} ${styles.span12}`}>
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

      <AnimatedContent distance={20} delay={200 / 1000} direction="vertical" className={styles.achievement}>
        <AchievementWall snapshot={snapshot} />
      </AnimatedContent>
    </>
  );
}
