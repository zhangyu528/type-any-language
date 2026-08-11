'use client';

/**
 * DataBento — 方案 B SECTION 4
 *
 * 4 数据横排(产品口径):词库数 / 句数 / 上手时间 / 价格
 * 大数字走 AnimatedCounter,进视口才从 0 滚到目标。
 *
 * 数据口径全部派生自 props.libs(后端 catalog)—— 不再硬编码 "12" /
 * "3000+" 之类的营销数字,避免用户被虚假承诺骗。
 *
 *   - 词库数:libs.length(当前 4)
 *   - 句数:sum(libs[].sentence_count)(catalog 接口新增字段,
 *     backend get_catalog 走一次 grouped COUNT(*) 算出)
 *   - 上手时间:30(秒)—— 这是登录后第一句开始打字的耗时口径,
 *     跟 FinalCTA "30 秒开始第一句" 一致;不依赖后端
 *   - 价格:免费 —— 文字,不进 counter
 *
 * 注意:
 *   - AnimatedCounter 必须是整数;单位走 sibling <span>(不在 counter 内,
 *     避免宽度跳变)
 *   - 大数字用 Fraunces display + tabular-nums,数字宽度稳定不抖
 */

import { motion } from 'motion/react';
import { AnimatedCounter } from '@/components/effects';
import { riseIn, staggerParent } from '../ds/motion';
import { VocabularyLib } from '../api';
import styles from './DataBento.module.css';

interface DataBentoProps {
  libs: VocabularyLib[];
}

interface DataPoint {
  value: number | 'free';
  counterSuffix?: string;
  unit?: string;
  sub: string;
}

export default function DataBento({ libs }: DataBentoProps) {
  // 从 catalog 派生真实统计。空 libs 走 0,避免 SSR/未加载态出现 NaN。
  const libCount = libs.length;
  const sentenceCount = libs.reduce(
    (acc, l) => acc + (l.sentence_count ?? 0),
    0,
  );

  const DATA: DataPoint[] = [
    { value: libCount, unit: '词库', sub: '入门到雅思' },
    { value: sentenceCount, counterSuffix: '+', unit: '句', sub: '真实语料' },
    { value: 30, unit: '秒', sub: '即可开始' },
    { value: 'free', sub: '无需注册' },
  ];

  return (
    <section className={styles.root} aria-labelledby="data-bento-title">
      <motion.header
        className={styles.header}
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -80px 0px' }}
      >
        <motion.p className={styles.kicker} variants={riseIn}>
          SECTION 4 · 数据
        </motion.p>
        <motion.h2
          id="data-bento-title"
          className={styles.title}
          variants={riseIn}
        >
          看见上手成本有多低。
        </motion.h2>
      </motion.header>

      <motion.div
        className={styles.grid}
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -80px 0px' }}
      >
        {DATA.map((d, i) => (
          <motion.div
            key={i}
            className={styles.cell}
            variants={riseIn}
            transition={{ delay: 0.08 * i }}
          >
            <div className={styles.big}>
              {d.value === 'free' ? (
                <span>免费</span>
              ) : (
                <>
                  <AnimatedCounter
                    value={d.value}
                    suffix={d.counterSuffix ?? ''}
                    startOnView
                  />
                  {d.unit && <span className={styles.unit}>{d.unit}</span>}
                </>
              )}
            </div>
            <p className={styles.sub}>{d.sub}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}