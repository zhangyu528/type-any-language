'use client';

/**
 * LearnedLibProgress — list of "you've practiced this lib" rows.
 *
 * Each card shows the level / name / completion % / accuracy.
 * Animation:
 *   - cards bounce in via BounceCards (gsap elastic.out(1, 0.8)
 *     with stagger), more lively than the prior motion fadeUp
 *   - on hover, sibling cards slide outward along x (enableHover)
 *   - completion % rolls up via AnimatedCounter on mount
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
import { AnimatedCounter, BounceCards, Particles } from '@/components/effects';
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

  // Render each card once. Reused as BounceCards children below.
  const cards = rows.map((row) => (
    <article className={styles.card} key={row.id}>
      <div className={styles.cardTop}>
        <div className={styles.nameWrap}>
          <span className={styles.level}>{row.level.toUpperCase()}</span>
          <h3 className={styles.name}>{row.name}</h3>
        </div>
        <span className={styles.percent}>
          {/* AnimatedCounter ticks 0 → completion % on mount; BounceCards
              owns the parent's stagger, so we don't trigger via
              startOnView here. */}
          <AnimatedCounter
            value={row.completion}
            startOnView={false}
            duration={1000}
            className={styles.percentCounter}
          />
          <span aria-hidden>%</span>
        </span>
      </div>
      {/* Bar fill animates from 0 → completion % via motion (still
          a separate sub-animation independent of BounceCards). */}
      <div className={styles.track} aria-hidden="true">
        <motion.span
          className={styles.fill}
          initial={{ width: 0 }}
          animate={{ width: `${row.completion}%` }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        />
      </div>
      <div className={styles.meta}>
        <span>已练 {row.answered} 句</span>
        <span>正确率 {row.accuracy}%</span>
      </div>
    </article>
  ));

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
        /* Empty state: subtle Particles background so the area doesn't
           feel like dead air. Slate-400 tints match the rest of the
           dashboard; count=18 keeps CPU light since this section is
           rarely visited (only when user hasn't practiced any lib). */
        <div className={styles.emptyState}>
          <Particles
            count={18}
            minSize={0.8}
            maxSize={2.2}
            speed={0.18}
            connectDistance={90}
            color="55, 138, 221"
            className={styles.emptyParticles}
          />
          <p className={styles.empty}>
            完成第一句练习后，这里会显示你的词库进度。
          </p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        /* BounceCards: gsap elastic.out(1, 0.8) entrance, 60ms
           stagger between cards. transformStyles all 'none' so the
           cards sit in their natural grid positions (instead of the
           upstream's scattered/rotated gallery look). enableHover
           pushes siblings sideways on hover (offset ±48px since
           we're in a 2-col grid, not a wide canvas). */
        <BounceCards
          containerWidth="100%"
          containerHeight="auto"
          animationDelay={0.4}
          animationStagger={0.06}
          easeType="elastic.out(1, 0.8)"
          transformStyles={rows.map(() => 'none')}
          enableHover
          className={styles.list}
        >
          {cards}
        </BounceCards>
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
