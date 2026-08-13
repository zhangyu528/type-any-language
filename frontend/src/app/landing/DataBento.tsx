'use client';

/**
 * DataBento — SECTION 3 数据(2026-08 inline 范式)
 *
 * 4 数据点(产品口径):词库数 / 句数 / 上手时间 / 价格
 * 数据派生自 props.libs(后端 catalog)—— 不再硬编码营销数字。
 *
 * 2026-08 范式重设计:
 *   - 之前:4 cell 网格 + BlurText,跟 HowItWorks / LibStrip 同构(卡片矩阵)
 *   - 现在:inline stats row,1 行 4 个数据点(数字+小字标签) + · 分隔
 *   - 完全脱离"卡片"形态,跟前 3 个 section 形成视觉反差
 *   - 副标签放第二行(mono font,缩进对齐主数字),信息密度高
 *
 * 数字走 Counter 进视口 0 → 目标;"免费"用 --ds-cta 朱砂粉保留转化色。
 */

import AnimatedContent from '@/components/AnimatedContent';
import Counter from '@/components/Counter';
import { useReducedMotion } from 'motion/react';
import { VocabularyLib } from '../api';
import styles from './DataBento.module.css';

interface DataBentoProps {
  libs: VocabularyLib[];
}

interface DataPoint {
  value: number | 'free';
  counterSuffix?: string;
  unit?: string;
  label: string;
}

export default function DataBento({ libs }: DataBentoProps) {
  const reduce = useReducedMotion();
  const libCount = libs.length;
  const sentenceCount = libs.reduce(
    (acc, l) => acc + (l.sentence_count ?? 0),
    0,
  );

  // 4 个数据点 —— 主数据(数字 + 单位) + 副标签(产品自描述)
  const DATA: DataPoint[] = [
    { value: libCount,           unit: '份', label: 'A1-C1 全覆盖' },
    { value: sentenceCount,      counterSuffix: '+', unit: '句', label: '真句库' },
    { value: 30,                 unit: '秒', label: '即可开口' },
    { value: 'free',                                label: '永久免费' },
  ];

  return (
    <section id="data-bento" className={styles.root} aria-labelledby="data-bento-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 3 · 数据</p>
        <h2 id="data-bento-title" className={styles.title}>
          看见上手成本有多低。
        </h2>
      </AnimatedContent>

      {/* inline stats row —— 完全脱离卡片形态,4 个数据点一行扫读 */}
      <AnimatedContent
        distance={12}
        delay={120 / 1000}
        direction="vertical"
        className={styles.statsRow}
        role="list"
        aria-label="产品数据"
      >
        {DATA.map((d, i) => {
          const isFree = d.value === 'free';
          return (
            <div
              key={i}
              className={`${styles.statItem} ${isFree ? styles.statFree : ''}`}
              role="listitem"
            >
              <div className={styles.mainValue}>
                {isFree ? (
                  <span className={styles.freeText}>免费</span>
                ) : (
                  <>
                    <Counter
                      value={typeof d.value === 'number' ? d.value : 0}
                      fontSize={48}
                      className={styles.value}
                    />
                    {d.unit && <span className={styles.unit}>{d.unit}</span>}
                  </>
                )}
              </div>
              <p className={styles.label}>{d.label}</p>
            </div>
          );
        })}
      </AnimatedContent>
    </section>
  );
}