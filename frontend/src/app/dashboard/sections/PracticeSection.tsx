'use client';

/**
 * PracticeSection — the "发现" partition of the console (was "练习" / "课程").
 *
 * A browsable course catalog. A vocabulary lib is the first course_type
 * ("vocab"); future grammar / listening / exam courses attach to the same
 * surface via the `course_type` discriminator. The grid reuses the upgraded
 * LibCard (type chip + accent bar + progress + status-aware CTA) and adds a
 * filter bar (category chips + search + sort) plus a "继续学习" featured card
 * for the most recently practiced course.
 *
 * Goal editing (DailyGoal / MonthlyGoal) moved out of this surface into
 * SettingsSection — this partition is pure browsing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../../components/ThemeProvider';
import {
  Catalog,
  VocabularyLib,
  loadTranslationProgress,
  libProgressPct,
} from '../../api';
import { readRecentLibId } from '../../landing/data';
import {
  LibCard,
  COURSE_TYPE_META,
  courseAccentColor,
  courseTypeLabel,
} from '../LibPicker';
import styles from './PracticeSection.module.css';

export type CourseTab = 'mine' | 'discover';

interface PracticeSectionProps {
  catalog: Catalog;
  onPickLib: (libId: string) => void;
  /** User id for localStorage progress lookup (per-course completion %). */
  userId: string;
  /** The user's enrolled course ids ("我的课程"). */
  enrolledLibIds: string[];
  /** Add a course to 我的课程. */
  onEnroll: (libId: string) => void;
  /** Remove a course from 我的课程. */
  onUnenroll: (libId: string) => void;
  /** 当前子视图（受 page 级控制，主页「查看全部」可深链到此）。 */
  courseTab: CourseTab;
  /** 切换子视图。 */
  onCourseTabChange: (tab: CourseTab) => void;
  /** 从 landing 选词库注册而来:高亮并滚动到该词库(发现 tab 内)。 */
  pendingLibId?: string | null;
}

export default function PracticeSection({
  catalog,
  onPickLib,
  userId,
  enrolledLibIds,
  onEnroll,
  onUnenroll,
  courseTab,
  onCourseTabChange,
  pendingLibId,
}: PracticeSectionProps) {
  const [activeType, setActiveType] = useState<string>('all');
  const [query, setQuery] = useState('');
  const { theme } = useTheme();
  const progress = useMemo(
    () => loadTranslationProgress(userId),
    [userId],
  );

  // Distinct course types present in the catalog → filter chips.
  const types = useMemo(
    () => Array.from(new Set(catalog.libs.map((l) => l.course_type ?? 'vocab'))),
    [catalog],
  );
  // 当前 seed 所有 lib 都是 course_type='vocab'，分面只有 1 个值时
  // 「全部 / 词汇」是死 UI（点词汇=点全部）。此时隐藏整行 chips；
  // 未来出现多 course_type 会自动恢复显示。
  const showTypeChips = types.length > 1;

  // 「我的课程」= 已选集合；「课程库」= 全部词库（已选的也展示，
  // 仅标记为"已添加"并可直接进入练习，强化"添加=移入我的课程"的心智）。
  // 选课状态由父页面持有，本分区只做反映。
  const mineLibs = useMemo(
    () => catalog.libs.filter((l) => enrolledLibIds.includes(l.id)),
    [catalog, enrolledLibIds],
  );
  const sourceLibs = courseTab === 'mine' ? mineLibs : catalog.libs;

  // "继续学习" — the most recently practiced lib, shown only if it has progress
  // and lives in the user's 我的课程 set.
  const recentLibId = useMemo(() => readRecentLibId(), []);
  const recentLib = recentLibId
    ? catalog.libs.find((l) => l.id === recentLibId) ?? null
    : null;
  const recentPct = recentLib ? libProgressPct(recentLib, progress) : 0;
  const showFeatured =
    courseTab === 'mine' && recentLib && recentPct > 0 && enrolledLibIds.includes(recentLib.id);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = sourceLibs.filter((lib) => {
      if (activeType !== 'all' && (lib.course_type ?? 'vocab') !== activeType) {
        return false;
      }
      if (q) {
        const hay = `${lib.name} ${lib.description ?? ''} ${lib.level}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // 「我的课程」默认按进度降序：最近在练的排前面。
    if (courseTab === 'mine') {
      list = [...list].sort(
        (a, b) => libProgressPct(b, progress) - libProgressPct(a, progress),
      );
    }
    return list;
  }, [sourceLibs, activeType, query, progress, courseTab]);

  // 从 landing 选词库注册而来:滚动到该词库卡片并高亮 ~2.6s,承接"已为你添加"。
  const highlightRef = useRef<HTMLLIElement | null>(null);
  const [highlightOn, setHighlightOn] = useState(false);
  const pendingVisible = pendingLibId
    ? visible.some((l) => l.id === pendingLibId)
    : false;
  useEffect(() => {
    if (!pendingLibId || !pendingVisible) return;
    const el = highlightRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightOn(true);
    const t = window.setTimeout(() => setHighlightOn(false), 2600);
    return () => window.clearTimeout(t);
  }, [pendingLibId, pendingVisible, courseTab]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headText}>
          <h2 className={styles.heading}>课程中心</h2>
          <p className={styles.sub}>在「课程库」浏览并添加课程,或在「我的课程」继续学习。</p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.tabs} role="tablist" aria-label="课程视图">
            <button
              type="button"
              role="tab"
              aria-selected={courseTab === 'mine'}
              className={`${styles.tab} ${courseTab === 'mine' ? styles.tabActive : ''}`}
              onClick={() => onCourseTabChange('mine')}
            >
              我的课程
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={courseTab === 'discover'}
              className={`${styles.tab} ${courseTab === 'discover' ? styles.tabActive : ''}`}
              onClick={() => onCourseTabChange('discover')}
            >
              课程库
            </button>
          </div>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="搜索课程…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索课程"
          />
        </div>
      </div>

      {showTypeChips ? (
        <div className={styles.chips} role="tablist" aria-label="课程分类">
          <button
            type="button"
            role="tab"
            aria-selected={activeType === 'all'}
            className={`${styles.chip} ${activeType === 'all' ? styles.chipActive : ''}`}
            onClick={() => setActiveType('all')}
          >
            全部
          </button>
          {types.map((t) => {
            const meta = COURSE_TYPE_META[theme][t] ?? COURSE_TYPE_META[theme].vocab;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={activeType === t}
                className={`${styles.chip} ${activeType === t ? styles.chipActive : ''}`}
                onClick={() => setActiveType(t)}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {showFeatured && recentLib ? (
        <FeaturedCourse
          lib={recentLib}
          pct={recentPct}
          onPick={() => onPickLib(recentLib.id)}
          theme={theme}
        />
      ) : null}

      {visible.length === 0 ? (
        courseTab === 'mine' ? (
          <button
            type="button"
            className={styles.emptyAction}
            onClick={() => onCourseTabChange('discover')}
          >
            你还没有课程,去「课程库」挑一个添加 →
          </button>
        ) : query.trim() ? (
          <div className={styles.emptyWrap}>
            <p className={styles.empty}>没有匹配「{query.trim()}」的课程</p>
            <button
              type="button"
              className={styles.emptyAction}
              onClick={() => setQuery('')}
            >
              清除搜索
            </button>
          </div>
        ) : (
          <p className={styles.empty}>还没有上架的课程。</p>
        )
      ) : (
        <motion.ul
          className={styles.grid}
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
          initial="hidden"
          animate="show"
        >
          <AnimatePresence mode="popLayout">
            {visible.map((lib) => {
              const isEnrolled = enrolledLibIds.includes(lib.id);
              const inMine = courseTab === 'mine';
              // 课程库里已加入的：直接进练习（而非重复添加）；未加入的：添加。
              const onClick = inMine || isEnrolled ? () => onPickLib(lib.id) : () => onEnroll(lib.id);
              const ctaLabel =
                inMine || isEnrolled ? undefined : '添加';
              const liClass = [
                inMine ? styles.cardCellWrap : '',
                lib.id === pendingLibId && highlightOn ? styles.cardHighlight : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined;
              return (
                <motion.li
                  key={lib.id}
                  ref={lib.id === pendingLibId ? highlightRef : undefined}
                  layout
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
                  className={liClass}
                >
                  <LibCard
                    lib={lib}
                    onClick={onClick}
                    progressPct={libProgressPct(lib, progress)}
                    ctaLabel={ctaLabel}
                    enrolled={!inMine && isEnrolled}
                    showProgress={inMine || isEnrolled}
                    theme={theme}
                  />
                  {inMine ? (
                    <button
                      type="button"
                      className={styles.removeCourse}
                      onClick={() => onUnenroll(lib.id)}
                      aria-label={`从我的课程移除 ${lib.name}`}
                      title="移除课程"
                    >
                      ✕
                    </button>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}

function FeaturedCourse({
  lib,
  pct,
  onPick,
  theme,
}: {
  lib: VocabularyLib;
  pct: number;
  onPick: () => void;
  theme: 'light' | 'dark';
}) {
  const color = courseAccentColor(lib, theme);
  return (
    <div className={styles.featured}>
      <span className={styles.featuredBar} style={{ background: color }} aria-hidden />
      <div className={styles.featuredBody}>
        <span className={styles.featuredKicker} style={{ color }}>
          {courseTypeLabel(lib, theme)}
        </span>
        <h3 className={styles.featuredName}>{lib.name}</h3>
        <p className={styles.featuredMeta}>
          已学 {pct}% · 剩 {Math.max(0, 100 - pct)}% 完成
        </p>
      </div>
      <button type="button" className={styles.featuredCta} onClick={onPick} style={{ borderColor: color, color }}>
        继续 →
      </button>
    </div>
  );
}
