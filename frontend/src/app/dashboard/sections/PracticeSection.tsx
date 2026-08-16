'use client';

/**
 * PracticeSection — the "课程" partition of the console (was "练习").
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

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
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

type SortKey = 'recommended' | 'progress' | 'level';

interface PracticeSectionProps {
  catalog: Catalog;
  onPickLib: (libId: string) => void;
  onStartPractice: () => void;
  /** User id for localStorage progress lookup (per-course completion %). */
  userId: string;
}

export default function PracticeSection({
  catalog,
  onPickLib,
  onStartPractice,
  userId,
}: PracticeSectionProps) {
  const [activeType, setActiveType] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recommended');

  const progress = useMemo(
    () => loadTranslationProgress(userId),
    [userId],
  );

  // Distinct course types present in the catalog → filter chips.
  const types = useMemo(
    () => Array.from(new Set(catalog.libs.map((l) => l.course_type ?? 'vocab'))),
    [catalog],
  );

  // "继续学习" — the most recently practiced lib, shown only if it has progress.
  const recentLibId = useMemo(() => readRecentLibId(), []);
  const recentLib = recentLibId
    ? catalog.libs.find((l) => l.id === recentLibId) ?? null
    : null;
  const recentPct = recentLib ? libProgressPct(recentLib, progress) : 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = catalog.libs.filter((lib) => {
      if (activeType !== 'all' && (lib.course_type ?? 'vocab') !== activeType) {
        return false;
      }
      if (q) {
        const hay = `${lib.name} ${lib.description ?? ''} ${lib.level}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === 'progress') {
      list = [...list].sort(
        (a, b) => libProgressPct(b, progress) - libProgressPct(a, progress),
      );
    } else if (sort === 'level') {
      list = [...list].sort((a, b) =>
        a.level === b.level
          ? a.name.localeCompare(b.name)
          : a.level.localeCompare(b.level),
      );
    }
    return list;
  }, [catalog, activeType, query, sort, progress]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headText}>
          <h2 className={styles.heading}>课程</h2>
          <p className={styles.sub}>浏览全部学习路径,挑一个开始或继续。</p>
        </div>
        <button type="button" className={styles.quickStart} onClick={onStartPractice}>
          快速开始 →
        </button>
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
        <label className={styles.sort}>
          <span className={styles.sortLabel}>排序</span>
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="排序方式"
          >
            <option value="recommended">推荐</option>
            <option value="progress">进度</option>
            <option value="level">难度</option>
          </select>
        </label>
      </div>

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
          const meta = COURSE_TYPE_META[t] ?? COURSE_TYPE_META.vocab;
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

      {recentLib && recentPct > 0 ? (
        <FeaturedCourse
          lib={recentLib}
          pct={recentPct}
          onPick={() => onPickLib(recentLib.id)}
        />
      ) : null}

      {visible.length === 0 ? (
        <p className={styles.empty}>没有匹配的课程。</p>
      ) : (
        <motion.ul
          className={styles.grid}
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
          initial="hidden"
          animate="show"
        >
          {visible.map((lib) => (
            <motion.li key={lib.id} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
              <LibCard
                lib={lib}
                onClick={() => onPickLib(lib.id)}
                progressPct={libProgressPct(lib, progress)}
              />
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function FeaturedCourse({
  lib,
  pct,
  onPick,
}: {
  lib: VocabularyLib;
  pct: number;
  onPick: () => void;
}) {
  const color = courseAccentColor(lib);
  return (
    <div className={styles.featured}>
      <span className={styles.featuredBar} style={{ background: color }} aria-hidden />
      <div className={styles.featuredBody}>
        <span className={styles.featuredKicker} style={{ color }}>
          {courseTypeLabel(lib)}
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
