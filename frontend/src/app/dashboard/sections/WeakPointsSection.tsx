'use client';

/**
 * WeakPointsSection v2 — 数据分区「薄弱点诊断」。
 *
 * 数据由 DataSection 统一拉取（GET /api/weakness）后下发，避免与
 * DistributionPanel 重复请求。本组件负责：
 *   - CEFR / 话题 筛选 chips
 *   - 按错误率 / 错误次数 排序
 *   - 每句「去练习」(onStartLib) 与「加入复习」(云端收藏，使其进入复习候选)
 *
 * 拉取失败 / 无数据时由父级通过 props 传入状态，本组件做降级渲染。
 */

import { useMemo, useState } from 'react';
import { Target, Plus } from 'lucide-react';
import { addToCollection, WeaknessPayload, WeakSentence } from '../../api';
import card from '../card.module.css';
import styles from './WeakPointsSection.module.css';

interface Props {
  data: WeaknessPayload | null;
  loading: boolean;
  error: string | null;
  userId: string;
  onStartLib: (libId: string) => void;
}

type SortKey = 'rate' | 'freq';
type FilterKey = string; // 'all' | cefr | topic

function rateClass(r: number): string {
  if (r >= 0.65) return styles.hi;
  if (r >= 0.5) return styles.mid;
  return styles.lo;
}

export default function WeakPointsSection({ data, loading, error, userId, onStartLib }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('rate');
  const [added, setAdded] = useState<Set<string>>(new Set());

  const filters = useMemo(() => {
    if (!data) return ['all'];
    const set = new Set<string>(['all']);
    data.weak_cefr.forEach((c) => set.add(c.cefr));
    data.weak_topics.forEach((t) => set.add(t.topic));
    return Array.from(set);
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    let rows = data.weak_sentences;
    if (filter !== 'all') {
      rows = rows.filter((s) => s.cefr === filter || s.topic === filter);
    }
    const sorted = [...rows].sort((a, b) =>
      sort === 'rate' ? b.error_rate - a.error_rate : b.wrong_count - a.wrong_count,
    );
    return sorted;
  }, [data, filter, sort]);

  if (loading) {
    return (
      <div className={`${card.card} ${styles.root}`}>
        <p className={styles.title}>薄弱点诊断</p>
        <p className={styles.muted}>加载中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${card.card} ${styles.root}`}>
        <p className={styles.title}>薄弱点诊断</p>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  if (!data || data.weak_sentences.length === 0) {
    return (
      <div className={`${card.card} ${styles.root}`}>
        <p className={styles.title}>薄弱点诊断</p>
        <p className={styles.good}>
          还没有常错句——继续保持，程序会自动记录你最容易错的句子。
        </p>
      </div>
    );
  }

  const handleReview = (s: WeakSentence) => {
    addToCollection(s.sentence_id, s.target_words[0] ?? '', userId, s.lib_id ?? undefined);
    setAdded((prev) => new Set(prev).add(s.sentence_id));
  };

  return (
    <div className={`${card.card} ${styles.root}`}>
      <div className={styles.chead}>
        <p className={styles.title}>薄弱点诊断</p>
        <span className={styles.summary}>
          共 {list.length} 句常错 · 终身准确率{' '}
          {data.totals.accuracy != null ? `${Math.round(data.totals.accuracy * 100)}%` : '—'}
        </span>
      </div>

      <div className={styles.filters}>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.chip} ${filter === f ? styles.chipOn : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? '全部' : f}
          </button>
        ))}
      </div>

      <div className={styles.sortBtns}>
        <button
          type="button"
          className={`${styles.sortBtn} ${sort === 'rate' ? styles.sortOn : ''}`}
          onClick={() => setSort('rate')}
        >
          按错误率
        </button>
        <button
          type="button"
          className={`${styles.sortBtn} ${sort === 'freq' ? styles.sortOn : ''}`}
          onClick={() => setSort('freq')}
        >
          按错误次数
        </button>
      </div>

      <div className={styles.sentList}>
        {list.length === 0 ? (
          <p className={styles.muted}>该筛选下暂无常错句。</p>
        ) : (
          list.map((s) => {
            const rate = Math.round(s.error_rate * 100);
            const isAdded = added.has(s.sentence_id);
            return (
              <div key={s.sentence_id} className={styles.sentCard}>
                <div className={styles.sentTop}>
                  <span className={styles.sentText}>{s.text}</span>
                  <span
                    className={`${styles.rate} ${rateClass(s.error_rate)}`}
                    title={`错误率 ${rate}%（${s.wrong_count}/${s.attempts}）`}
                  >
                    {rate}%
                  </span>
                </div>
                {s.chinese_text ? <p className={styles.sentZh}>{s.chinese_text}</p> : null}
                {s.target_words.length > 0 ? (
                  <div className={styles.words}>
                    {s.target_words.map((w) => (
                      <span key={w} className={styles.wordChip}>
                        {w}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className={styles.sentFoot}>
                  <span className={styles.meta}>
                    错 {s.wrong_count} · 共 {s.attempts} 次 · {s.cefr}/{s.topic}
                  </span>
                  <span className={styles.acts}>
                    <button
                      type="button"
                      className={styles.reviewBtn}
                      onClick={() => handleReview(s)}
                      disabled={isAdded}
                    >
                      <Plus size={14} /> {isAdded ? '已加入' : '加入复习'}
                    </button>
                    <button
                      type="button"
                      className={styles.cta}
                      onClick={() => s.lib_id && onStartLib(s.lib_id)}
                      disabled={!s.lib_id}
                    >
                      <Target size={14} /> 去练习
                    </button>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
