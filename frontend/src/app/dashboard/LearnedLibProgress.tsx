'use client';

/**
 * LearnedLibProgress — list of "you've practiced this lib" rows.
 *
 * Each card shows the level / name / completion % / accuracy. Previously
 * this component discarded the computed progress and rendered random
 * pravatar avatars instead — the real data now drives the UI.
 *
 * Animation:
 *   - cards stagger in via motion (riseIn) on mount
 *   - completion % rolls up via AnimatedCounter
 *   - progress bar fill animates width from 0 → completion %
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Catalog,
  getContentCatalog,
  loadTranslationProgress,
  TranslationProgress,
} from '../api';
import { riseIn, staggerParent } from '../ds/motion';
import Counter from '@/components/Counter';
import Particles from '@/components/Particles';
import styles from './LearnedLibProgress.module.css';

interface LearnedLibProgressProps {
  userId: string;
}

interface LibProgressRow {
  id: string;
  name: string;
  level: string;
  answered: number;
  correct: number;
  accuracy: number;
  /** A practical visual estimate based on answered sentences vs lib size. */
  completion: number;
}

export default function LearnedLibProgress({ userId }: LearnedLibProgressProps) {
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setProgress(loadTranslationProgress(userId));
    refresh();
    window.addEventListener('translation-progress-changed', refresh);
    return () => window.removeEventListener('translation-progress-changed', refresh);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    getContentCatalog()
      .then((value) => {
        if (!cancelled) setCatalog(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '加载词库失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => (catalog ? buildRows(progress, catalog) : []),
    [catalog, progress],
  );

  return (
    <section className={styles.root} aria-label="学过的词库进度">
      <div className={styles.header}>
        <h2 className={styles.heading}>学过的词库</h2>
        {rows.length > 0 ? (
          <span className={styles.count}>{rows.length} 个</span>
        ) : null}
      </div>

      {error ? <p className={styles.empty}>暂时无法加载词库进度。</p> : null}
      {!error && !catalog ? <p className={styles.empty}>加载中…</p> : null}
      {!error && catalog && rows.length === 0 ? (
        // Empty state: subtle Particles background so the area doesn't
        // feel like dead air. Slate-400 tints match the rest of the
        // dashboard; count=18 keeps CPU light since this section is
        // rarely visited (only when user hasn't practiced any lib).
        <div className={styles.emptyState}>
          <Particles
            particleCount={18}
            speed={0.18}
            particleColors={["#378ADD"]}
            className={styles.emptyParticles}
          />
          <p className={styles.empty}>
            完成第一句练习后，这里会显示你的词库进度。
          </p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <motion.div
          className={styles.list}
          variants={staggerParent}
          initial="hidden"
          animate="show"
        >
          {rows.map((row) => (
            <motion.div
              key={row.id}
              className={styles.card}
              variants={riseIn}
            >
              <div className={styles.cardTop}>
                <div className={styles.nameWrap}>
                  <span className={styles.level}>{row.level}</span>
                  <p className={styles.name} title={row.name}>{row.name}</p>
                </div>
                <span className={styles.percent}>
                  <Counter
                    value={row.completion}
                    fontSize={14}
                    className={styles.percentCounter}
                  />
                  <span aria-hidden>%</span>
                </span>
              </div>
              <div
                className={styles.track}
                role="progressbar"
                aria-valuenow={row.completion}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${row.name} 完成度 ${row.completion}%`}
              >
                <motion.span
                  className={styles.fill}
                  initial={{ width: 0 }}
                  animate={{ width: `${row.completion}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
              <div className={styles.meta}>
                已练 {row.answered} 句 · 正确率 {row.accuracy}%
              </div>
            </motion.div>
          ))}
        </motion.div>
      ) : null}
    </section>
  );
}

function buildRows(progress: TranslationProgress, catalog: Catalog): LibProgressRow[] {
  const rows: LibProgressRow[] = [];
  for (const lib of catalog.libs) {
    const sentences = progress[lib.id]?.sentences ?? {};
    const entries = Object.values(sentences);
    if (entries.length === 0) continue;
    const correct = entries.filter((item) => item.correct).length;
    rows.push({
      id: lib.id,
      name: lib.name,
      level: lib.level,
      answered: entries.length,
      correct,
      accuracy: Math.round((correct / entries.length) * 100),
      completion: Math.min(100, Math.round((entries.length / Math.max(1, lib.word_count)) * 100)),
    });
  }
  return rows.sort((a, b) => b.answered - a.answered);
}
