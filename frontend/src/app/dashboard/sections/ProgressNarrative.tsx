'use client';

/**
 * ProgressNarrative — 进度叙事（方向 B 新模块）。
 *
 * 把"我离目标还有多远"做成两条叙事化进度，而非图表（不与「数据」
 * 分区冲突）：
 *   1. 词库通关：聚焦"最接近通关"的那本词库，显示《X》还差 N 句通关
 *      （完成度 = 已练句数 / lib.word_count，复用 LearnedLibProgress 的
 *       localStorage 进度源，零后端改动）。
 *   2. 本月目标：X/Y 天 · 还差 D 天达标（或已达成）。
 *
 * 进度源为 localStorage，监听 translation-progress-changed 即时刷新。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Catalog,
  loadTranslationProgress,
  MonthlyGoalInfo,
  TranslationProgress,
} from '../../api';
import styles from './ProgressNarrative.module.css';

interface ProgressNarrativeProps {
  userId: string;
  catalog?: Catalog | null;
  monthlyGoal: MonthlyGoalInfo;
}

interface LibRow {
  id: string;
  name: string;
  total: number;
  answered: number;
  completion: number;
}

export default function ProgressNarrative({
  userId,
  catalog,
  monthlyGoal,
}: ProgressNarrativeProps) {
  const [progress, setProgress] = useState<TranslationProgress>({});

  useEffect(() => {
    const refresh = () => setProgress(loadTranslationProgress(userId));
    refresh();
    window.addEventListener('translation-progress-changed', refresh);
    return () => window.removeEventListener('translation-progress-changed', refresh);
  }, [userId]);

  const rows = useMemo<LibRow[]>(() => {
    if (!catalog) return [];
    return catalog.libs
      .map((lib) => {
        const sents = progress[lib.id]?.sentences ?? {};
        const answered = Object.keys(sents).length;
        const total = lib.word_count;
        const completion = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
        return { id: lib.id, name: lib.name, total, answered, completion };
      })
      .filter((r) => r.answered > 0);
  }, [catalog, progress]);

  // 聚焦"最接近通关"的词库（完成度最高且未 100%），没有则取进度最高。
  const focus = useMemo<LibRow | null>(() => {
    const inProgress = rows
      .filter((r) => r.completion < 100)
      .sort((a, b) => b.completion - a.completion);
    return inProgress[0] ?? [...rows].sort((a, b) => b.completion - a.completion)[0] ?? null;
  }, [rows]);

  const mRemain = monthlyGoal.achieved
    ? 0
    : Math.max(0, monthlyGoal.target - monthlyGoal.current);
  const mPct =
    monthlyGoal.target > 0
      ? Math.min(100, Math.round((monthlyGoal.current / monthlyGoal.target) * 100))
      : 0;
  const libRemain = focus ? Math.max(0, focus.total - focus.answered) : 0;

  return (
    <section className={styles.root} aria-label="进度">
      <p className={styles.title}>进度</p>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.rowLabel}>{focus ? `《${focus.name}》通关` : '词库通关'}</span>
          <span className={styles.rowNum}>{focus ? `${focus.completion}%` : '—'}</span>
        </div>
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${focus ? focus.completion : 0}%` }} />
        </div>
        <p className={styles.rowSub}>
          {focus
            ? libRemain > 0
              ? `还差 ${libRemain} 句通关`
              : '已通关，挑下一本吧'
            : '开始练习后，这里显示通关进度'}
        </p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.rowLabel}>本月目标</span>
          <span className={styles.rowNum}>
            {monthlyGoal.current}/{monthlyGoal.target} 天
          </span>
        </div>
        <div className={styles.track}>
          <div className={`${styles.fill} ${styles.fillMint}`} style={{ width: `${mPct}%` }} />
        </div>
        <p className={styles.rowSub}>
          {monthlyGoal.achieved ? '本月已达成' : `还差 ${mRemain} 天达标`}
        </p>
      </div>
    </section>
  );
}
