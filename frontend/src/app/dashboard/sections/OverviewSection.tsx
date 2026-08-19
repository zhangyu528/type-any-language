'use client';

/**
 * OverviewSection — 概览（方向 B：个人学习日报）。
 *
 * 信息架构：顶部 Hero（问候 + 连击胶囊「唯一连击源」+ 本月目标迷你条）
 * → 快速入口（发现 / 数据 / 成就 / 复习）→ 12 列 Bento 网格。
 *   · 行动区：继续练习(span6) / 今日目标(span3) / 连击动量(span3) + 我的课程(span12)
 *   · 洞察区：守住火花(span4) / 提升等级(span4) / 获取徽章(span4)
 *
 * 去重：连击只在 Hero 胶囊 + 连击动量出现；月目标只在 Hero 迷你条出现；
 * 习惯时刻只在 TodaySuggestion 出现。
 *
 * 首跑欢迎 Hero(FirstRunGuide)已上提到 dashboard/page.tsx,整页覆盖任何
 * 分区渲染(含选词库注册落 ?section=practice 的入口),本组件只负责概览网格。
 *
 * 本组件只做展示拼装，数据来自 page.tsx 传入的 snapshot + catalog。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Catalog,
  DashboardSnapshot,
  loadTranslationProgress,
  libProgressPct,
  TranslationProgress,
} from '../../api';

const ACCENT_VARS: Record<string, string> = {
  blue: 'var(--ds-action)',
  green: 'var(--ds-correct)',
  amber: 'var(--ds-cta)',
  purple: 'var(--ds-convert)',
};

function accentVar(accent?: string | null): string {
  return (accent && ACCENT_VARS[accent]) || 'var(--ds-action)';
}

/**
 * 守护等级 — 独立于徽章的用户等级体系，按「使用天数」（账号注册至今的天数）分级。
 * 与徽章（deriveAchievements）是完全两套逻辑：徽章看练习行为里程碑，
 * 守护等级只看账号使用时长，代表用户与产品的绑定深度（忠诚度）。
 */

interface GuardLevel {
  /** 当前等级（1 起）。 */
  level: number;
  /** 当前等级称号。 */
  title: string;
  /** 距下一级还差多少天（已满级为 0）。 */
  daysToNext: number;
  /** 是否已达最高等级。 */
  maxed: boolean;
}

const LEVEL_TIERS: ReadonlyArray<{ level: number; minDays: number; title: string }> = [
  { level: 1, minDays: 0, title: '初心守护' },
  { level: 2, minDays: 3, title: '见习守护' },
  { level: 3, minDays: 7, title: '初级守护' },
  { level: 4, minDays: 14, title: '进阶守护' },
  { level: 5, minDays: 30, title: '资深守护' },
  { level: 6, minDays: 60, title: '白银守护' },
  { level: 7, minDays: 90, title: '黄金守护' },
  { level: 8, minDays: 180, title: '铂金守护' },
  { level: 9, minDays: 365, title: '钻石守护' },
  { level: 10, minDays: 730, title: '传奇守护' },
];

/** 账号使用天数 = 注册至今的自然日数。 */
function computeTenureDays(createdAt?: string | null): number {
  if (!createdAt) return 0;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
}

function deriveGuardLevel(usageDays: number): GuardLevel {
  let cur = LEVEL_TIERS[0];
  for (const tier of LEVEL_TIERS) {
    if (usageDays >= tier.minDays) cur = tier;
    else break;
  }
  const idx = LEVEL_TIERS.indexOf(cur);
  const next = idx + 1 < LEVEL_TIERS.length ? LEVEL_TIERS[idx + 1] : null;
  return {
    level: cur.level,
    title: cur.title,
    daysToNext: next ? Math.max(0, next.minDays - usageDays) : 0,
    maxed: next === null,
  };
}
import AnimatedContent from '@/components/AnimatedContent';
import GreetingBar from '../GreetingBar';
import DailyGoal from '../DailyGoal';
import StreakMomentum from './StreakMomentum';
import ContinueCard from '../ContinueCard';
import TodaySuggestion from './TodaySuggestion';
import InsightStat from './InsightStat';
import { deriveAchievements } from './achievements';
import QuickNav from './QuickNav';
import styles from './OverviewSection.module.css';
import { DashboardSection } from '../DashboardNav';
import { TrendingUp, Award } from 'lucide-react';

interface OverviewSectionProps {
  snapshot: DashboardSnapshot;
  /** Eager-loaded catalog (page.tsx). Drives the quick-launch chips. */
  catalog?: Catalog | null;
  onPickLib: () => void;
  /** Jump straight into a lib's drill (used by the quick-launch chips). */
  onStartLib: (libId: string) => void;
  /** 继续上次未完成的练习会话（ContinueCard 主 CTA）。 */
  onResume: () => void;
  /** 把某词库设为当前进行中课程（只写 prefs.libId，不进入练习）。 */
  onSetCurrentLib?: (libId: string) => void;
  /** 快速入口导航（课程/数据/成就/复习 → 对应分区）。 */
  onNavigate: (section: DashboardSection) => void;
  /** 用户已选课程（我的课程）的 lib id 列表，驱动主页「我的课程」块。 */
  enrolledLibIds?: string[];
  /** 课程多于展示上限时，跳转到课程中心的「我的课程」tab 查看全部。 */
  onOpenMyCourses?: () => void;
  /** 从 landing 选词库注册而来：所选词库 id。存在时优先当作「当前进行中
   *  课程」，并跳过首跑引导（避免在已选词库的情况下还展示「浏览全部词库」）。 */
  selectedLibId?: string | null;
}

export default function OverviewSection({
  snapshot,
  catalog,
  onPickLib,
  onStartLib,
  onResume,
  onSetCurrentLib,
  onNavigate,
  enrolledLibIds,
  onOpenMyCourses,
  selectedLibId,
}: OverviewSectionProps) {
  // 最近词库（persisted in prefs.libId），供建议/快启/首跑态读取；
  // 点「我的课程」卡可切换当前进行中课程（setRecentId + onSetCurrentLib 落地持久化）。
  const [recentId, setRecentId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('prefs.libId') : null,
  );
  const recentLib = useMemo(
    () => (recentId && catalog ? catalog.libs.find((l) => l.id === recentId) ?? null : null),
    [recentId, catalog],
  );

  // 有效「当前进行中课程」= 从 landing 预选的词库 优先于 本地最近词库。
  // 这样注册时选了 CET4，主页直接锚定 CET4，而不是回退到 beginner / libs[0]。
  const effectiveRecentId = selectedLibId ?? recentId;
  const effectiveRecentLib = effectiveRecentId && catalog
    ? catalog.libs.find((l) => l.id === effectiveRecentId) ?? null
    : null;

  // 「当前进行中课程」只在用户确实已加入该课(enrolled,来自 user_courses)
  // 或确有真实练习进度(snapshot.continue.lib_id)时才算数;否则视为「无当前课」。
  // 这避免本机调试残留的 localStorage prefs.libId(如 beginner)被当成「正在学习」
  // 展示给其实没课的新用户——那时听音打字卡应显示空态 + 「添加课程」。
  const recentIsEnrolled = effectiveRecentId && enrolledLibIds
    ? enrolledLibIds.includes(effectiveRecentId)
    : false;
  const currentLibId = recentIsEnrolled ? effectiveRecentId : snapshot.continue.lib_id;

  // 我的课程：从已选课程集合过滤出 lib，最多 4 张。
  const myCourseLibs = useMemo(() => {
    if (!catalog || !enrolledLibIds || enrolledLibIds.length === 0) return [];
    const byId = new Map(catalog.libs.map((l) => [l.id, l]));
    return enrolledLibIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .slice(0, 4);
  }, [catalog, enrolledLibIds]);

  // 我的课程进度源：浏览器 localStorage（逐句进度），监听变更即时刷新。
  const [progress, setProgress] = useState<TranslationProgress>({});
  useEffect(() => {
    const refresh = () => setProgress(loadTranslationProgress(snapshot.user.id));
    refresh();
    window.addEventListener('translation-progress-changed', refresh);
    return () => window.removeEventListener('translation-progress-changed', refresh);
  }, [snapshot.user.id]);

  // 守护等级：独立于徽章，按账号使用天数（注册至今）分级。
  const guardLevel = useMemo(
    () => deriveGuardLevel(computeTenureDays(snapshot.user.created_at)),
    [snapshot.user.created_at],
  );

  // 获取徽章卡：复用 deriveAchievements 的徽章进度（与提升等级完全独立）。
  const achievements = useMemo(() => deriveAchievements(snapshot), [snapshot]);

  // 继续练习卡：锚定课程 = currentLibId（仅当用户已加入该课或有真实练习进度
  // 时才算数，避免本机残留 localStorage 把 beginner 当成「正在学习」）。
  // 无当前课时 currentLibId 为 null → 下方 ContinueCard 走空态 + 「添加课程」。
  const continueAnchorLib = useMemo(() => {
    const id = currentLibId;
    return id && catalog ? catalog.libs.find((l) => l.id === id) ?? null : null;
  }, [currentLibId, catalog]);

  // 继续练习卡进度条：锚定课程的浏览器逐句进度（localStorage）。
  const continueProgress = useMemo(() => {
    if (!continueAnchorLib) return null;
    const pct = libProgressPct(continueAnchorLib, progress);
    const answered = Object.keys(progress[continueAnchorLib.id]?.sentences ?? {}).length;
    const remain = Math.max(0, (continueAnchorLib.sentence_count || 0) - answered);
    return { pct, remain };
  }, [continueAnchorLib, progress]);

  return (
    <>
      <header className={styles.header}>
        <GreetingBar
          user={snapshot.user}
          streak={snapshot.streak}
          monthlyGoal={snapshot.monthly_goal}
          behind={!snapshot.daily_goal.completed}
        />
      </header>

      <QuickNav
        snapshot={snapshot}
        reviewDue={snapshot.review_due_count ?? 0}
        catalog={catalog}
        onNavigate={onNavigate}
      />

      <div className={styles.bento}>
        {/* 行动区：继续练习(span6) / 今日目标(span3) / 连击动量(span3) + 我的课程(span12) */}

        <AnimatedContent distance={20} direction="vertical" delay={0} className={`${styles.bentoCell} ${styles.span6}`}>
          <ContinueCard
            state={snapshot.continue}
            currentLib={continueAnchorLib ? { id: continueAnchorLib.id, name: continueAnchorLib.name } : null}
            catalog={catalog}
            onResume={onResume}
            onPickLib={onPickLib}
            onAddCourse={() => onNavigate('practice')}
            onStartLib={onStartLib}
            currentProgress={continueProgress}
            behind={!snapshot.daily_goal.completed}
          />
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
              <div className={styles.courseGrid}>
                {myCourseLibs.map((lib) => {
                  const pct = libProgressPct(lib, progress);
                  const answered = Object.keys(progress[lib.id]?.sentences ?? {}).length;
                  const remain = Math.max(0, (lib.sentence_count || 0) - answered);
                  const accent = accentVar(lib.accent);
                  const current = lib.id === effectiveRecentId;
                  return (
                    <button
                      key={lib.id}
                      type="button"
                      className={`${styles.courseCard}${current ? ` ${styles.courseCurrent}` : ''}`}
                      onClick={() => {
                        // 只切换「当前进行中课程」（写 prefs.libId），不进入练习流。
                        setRecentId(lib.id);
                        onSetCurrentLib?.(lib.id);
                      }}
                      aria-label={`把《${lib.name}》设为当前课程${pct >= 100 ? '（已通关）' : `，进度 ${pct}%`}`}
                    >
                      <span className={styles.courseTop}>
                        <span className={styles.courseDot} style={{ background: accent }} aria-hidden="true" />
                        <span className={styles.courseName}>{lib.name}</span>
                        {current ? (
                          <span className={styles.courseNow} style={{ color: accent }}>
                            进行中
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.courseTrack} aria-hidden="true">
                        <span className={styles.courseFill} style={{ width: `${pct}%`, background: accent }} />
                      </span>
                      <span className={styles.courseMeta}>
                        {pct >= 100 ? '已通关' : `还差 ${remain} 句`} · {pct}%
                      </span>
                    </button>
                  );
                })}
              </div>
              {enrolledLibIds && enrolledLibIds.length > 4 && onOpenMyCourses ? (
                <button
                  type="button"
                  className={styles.viewAll}
                  onClick={onOpenMyCourses}
                >
                  查看全部 {enrolledLibIds.length} 门课程 →
                </button>
              ) : null}
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

        {/* 洞察区：今日建议 / 提升等级 / 获取徽章（各 span4，满行 12 列）。
            三张卡复用同一套玻璃壳、等高对齐：今日建议=TodaySuggestion，
            提升等级与获取徽章=InsightStat。提升等级是独立于徽章的等级体系
            （按账号使用天数分级）；获取徽章直接复用 deriveAchievements 的进度。 */}

        <AnimatedContent distance={20} direction="vertical" delay={40 / 1000} className={`${styles.bentoCell} ${styles.span4}`}>
          <TodaySuggestion
            preferredHour={snapshot.preferred_hour}
            streak={snapshot.streak}
            dailyGoal={snapshot.daily_goal}
            recentLibId={effectiveRecentId}
            recentLibName={effectiveRecentLib?.name ?? null}
          />
        </AnimatedContent>

        <AnimatedContent distance={20} direction="vertical" delay={80 / 1000} className={`${styles.bentoCell} ${styles.span4}`}>
          <InsightStat
            title="提升等级"
            value={guardLevel.level}
            unit="级"
            icon={<TrendingUp size={18} />}
            accent="var(--ds-cta)"
            sub={
              guardLevel.maxed
                ? `${guardLevel.title} · 满级`
                : `${guardLevel.title} · 还差 ${guardLevel.daysToNext} 天升级`
            }
          />
        </AnimatedContent>

        <AnimatedContent distance={20} direction="vertical" delay={120 / 1000} className={`${styles.bentoCell} ${styles.span4}`}>
          <InsightStat
            title="获取徽章"
            value={achievements.earnedCount}
            unit="枚"
            icon={<Award size={18} />}
            accent="var(--ds-convert)"
            sub={
              achievements.next
                ? `还差 ${Math.max(0, achievements.next.target - achievements.next.current)}${achievements.next.unit} · ${achievements.next.label}`
                : `已集齐 ${achievements.badges.length} 枚`
            }
          />
        </AnimatedContent>

      </div>
    </>
  );
}
