'use client';

/**
 * WeaknessInsight — 薄弱·常错洞察（方向 B 新模块）。
 *
 * 复用 LearnedLibProgress 的 localStorage 进度源，算各词库准确率，
 * 挑"样本足够且准确率最低"的词库作为薄弱点，给"优先巩固"入口。
 * 无明显薄弱（都 ≥90% 或样本不足）时给正向反馈，保持卡片稳定。
 */

import { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { Catalog, loadTranslationProgress, TranslationProgress } from '../../api';
import styles from './WeaknessInsight.module.css';

interface WeaknessInsightProps {
  userId: string;
  catalog?: Catalog | null;
  onStartLib: (libId: string) => void;
}

interface LibRow {
  id: string;
  name: string;
  answered: number;
  accuracy: number;
}

export default function WeaknessInsight({ userId, catalog, onStartLib }: WeaknessInsightProps) {
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
        const entries = Object.values(sents);
        const answered = entries.length;
        const correct = entries.filter((s) => s.correct).length;
        const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        return { id: lib.id, name: lib.name, answered, accuracy };
      })
      .filter((r) => r.answered > 0);
  }, [catalog, progress]);

  const weak = useMemo<LibRow | null>(() => {
    const sampled = rows.filter((r) => r.answered >= 3);
    if (sampled.length === 0) return null;
    const below = sampled.filter((r) => r.accuracy < 90).sort((a, b) => a.accuracy - b.accuracy);
    return below[0] ?? null;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <section className={styles.root} aria-label="薄弱洞察">
        <p className={styles.title}>薄弱洞察</p>
        <p className={styles.empty}>多练几个词库，这里会指出你的薄弱点。</p>
      </section>
    );
  }

  if (!weak) {
    return (
      <section className={styles.root} aria-label="薄弱洞察">
        <p className={styles.title}>薄弱洞察</p>
        <p className={styles.good}>准确率都不错，继续保持。</p>
      </section>
    );
  }

  return (
    <section className={`${styles.root} ${styles.flag}`} aria-label="薄弱洞察">
      <p className={styles.title}>薄弱洞察</p>
      <p className={styles.line}>
        <span className={styles.name}>《{weak.name}》</span> 准确率 {weak.accuracy}%，建议优先巩固
      </p>
      <button type="button" className={styles.cta} onClick={() => onStartLib(weak.id)}>
        <Target size={15} /> 去复习
      </button>
    </section>
  );
}
