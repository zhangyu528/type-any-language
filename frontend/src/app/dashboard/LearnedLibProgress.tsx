'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Catalog,
  getContentCatalog,
  loadTranslationProgress,
  TranslationProgress,
} from '../api';
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
        <p className={styles.empty}>完成第一句练习后，这里会显示你的词库进度。</p>
      ) : null}
      {rows.length > 0 ? (
        <div className={styles.list}>
          {rows.map((row) => (
            <article className={styles.card} key={row.id}>
              <div className={styles.cardTop}>
                <div className={styles.nameWrap}>
                  <span className={styles.level}>{row.level.toUpperCase()}</span>
                  <h3 className={styles.name}>{row.name}</h3>
                </div>
                <span className={styles.percent}>{row.completion}%</span>
              </div>
              <div className={styles.track} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${row.completion}%` }} />
              </div>
              <div className={styles.meta}>
                <span>已练 {row.answered} 句</span>
                <span>正确率 {row.accuracy}%</span>
              </div>
            </article>
          ))}
        </div>
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
