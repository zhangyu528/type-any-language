'use client';

/**
 * WeakPointsSection — 数据分区里的「薄弱点」诊断（方案 1：薄弱点并进数据）。
 *
 * 数据来自 GET /api/weakness：聚合 practice_attempts 里的错误句 JOIN
 * sentences，给出常错句、常错词、常错话题、常错 CEFR 等级。这是被退休的
 * 手动「收藏」的替代——程序按错误率自动记录不熟悉的内容。
 *
 * 拉取失败时降级为内联提示，不阻塞数据页其它区块。
 */

import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { apiGetWeakness, WeaknessPayload, WeakSentence } from '../../api';
import LoadingMark from '../../components/LoadingMark';
import styles from './WeakPointsSection.module.css';

export default function WeakPointsSection({
  onStartLib,
}: {
  onStartLib: (libId: string) => void;
}) {
  const [data, setData] = useState<WeaknessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGetWeakness(15)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '获取薄弱点失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className={styles.root} aria-label="薄弱点">
        <p className={styles.title}>薄弱点</p>
        <LoadingMark />
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.root} aria-label="薄弱点">
        <p className={styles.title}>薄弱点</p>
        <p className={styles.error}>{error}</p>
      </section>
    );
  }

  const totals = data?.totals;
  const hasWrong = (data?.weak_sentences.length ?? 0) > 0;

  if (!hasWrong) {
    return (
      <section className={styles.root} aria-label="薄弱点">
        <p className={styles.title}>薄弱点</p>
        <p className={styles.good}>
          还没有常错句——继续保持，程序会自动记录你最容易错的句子。
        </p>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-label="薄弱点">
      <p className={styles.title}>薄弱点</p>

      <div className={styles.summary}>
        <span className={styles.sumItem}>
          终身准确率{' '}
          <b className={styles.sumNum}>
            {totals?.accuracy != null ? `${Math.round(totals.accuracy * 100)}%` : '—'}
          </b>
        </span>
        <span className={styles.sumItem}>
          常错句 <b className={styles.sumNum}>{data?.weak_sentences.length ?? 0}</b>
        </span>
        <span className={styles.sumItem}>
          错误尝试 <b className={styles.sumNum}>{totals?.wrong ?? 0}</b>
        </span>
      </div>

      {/* 常错句列表 */}
      <div className={styles.sentList}>
        {data?.weak_sentences.map((s: WeakSentence) => {
          const rate = Math.round(s.error_rate * 100);
          return (
            <div key={s.sentence_id} className={styles.sentCard}>
              <div className={styles.sentTop}>
                <span className={styles.sentText}>{s.text}</span>
                <span
                  className={styles.rate}
                  data-high={rate >= 60 ? 'true' : 'false'}
                  title={`错误率 ${rate}%（${s.wrong_count}/${s.attempts}）`}
                >
                  {rate}%
                </span>
              </div>
              {s.chinese_text ? (
                <p className={styles.sentZh}>{s.chinese_text}</p>
              ) : null}
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
                  错 {s.wrong_count} · 共 {s.attempts} 次
                </span>
                <button
                  type="button"
                  className={styles.cta}
                  onClick={() => s.lib_id && onStartLib(s.lib_id)}
                  disabled={!s.lib_id}
                >
                  <Target size={14} /> 去练习
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 常错词聚合 */}
      {data && data.weak_words.length > 0 ? (
        <div className={styles.block}>
          <p className={styles.blockTitle}>常错词</p>
          <div className={styles.chips}>
            {data.weak_words.map((w) => (
              <span key={w.word} className={styles.wordChip}>
                {w.word}
                <b className={styles.chipCount}>{w.wrong}</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* 常错话题 / CEFR */}
      {(data?.weak_topics.length ?? 0) > 0 || (data?.weak_cefr.length ?? 0) > 0 ? (
        <div className={styles.cols}>
          {data && data.weak_topics.length > 0 ? (
            <div className={styles.block}>
              <p className={styles.blockTitle}>常错话题</p>
              <div className={styles.chips}>
                {data.weak_topics.map((t) => (
                  <span key={t.topic} className={styles.topicChip}>
                    {t.topic}
                    <b className={styles.chipCount}>{t.wrong}</b>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {data && data.weak_cefr.length > 0 ? (
            <div className={styles.block}>
              <p className={styles.blockTitle}>常错等级</p>
              <div className={styles.chips}>
                {data.weak_cefr.map((c) => (
                  <span key={c.cefr} className={styles.topicChip}>
                    {c.cefr}
                    <b className={styles.chipCount}>{c.wrong}</b>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
