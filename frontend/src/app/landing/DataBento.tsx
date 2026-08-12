'use client';

/**
 * DataBento — 方案 B SECTION 4(2026-08 polish)
 *
 * 4 数据横排(产品口径):词库数 / 句数 / 上手时间 / 价格
 * 大数字走 Counter,进视口才从 0 滚到目标。
 *
 * 数据口径全部派生自 props.libs(后端 catalog)—— 不再硬编码 "12" /
 * "3000+" 之类的营销数字,避免用户被虚假承诺骗。
 *
 * 业界标准 polish:
 *   - 每张 cell 包 GlowCard,hover 时微弱 glow,提升"数据卡片"的存在感
 *   - header 用 AnimatedContent 替 motion 散件
 *   - "免费" 单独用 Card 包裹区别于数字 cell
 *
 *   - 词库数:libs.length(当前 4)
 *   - 句数:sum(libs[].sentence_count)(catalog 接口新增字段,
 *     backend get_catalog 走一次 grouped COUNT(*) 算出)
 *   - 上手时间:30(秒)—— 这是登录后第一句开始打字的耗时口径,
 *     跟 FinalCTA "30 秒开始第一句" 一致;不依赖后端
 *   - 价格:免费 —— 文字,不进 counter
 */

import AnimatedContent from '@/components/AnimatedContent';
import Counter from '@/components/Counter';
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
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 4 · 数据</p>
        <h2 id="data-bento-title" className={styles.title}>
          看见上手成本有多低。
        </h2>
      </AnimatedContent>

      <div className={styles.grid}>
        {DATA.map((d, i) => (
          <AnimatedContent
            key={i}
            distance={20}
            delay={(80 + i * 100) / 1000}
            direction="vertical"
            className={styles.cell}
          >
            <div className={styles.big}>
              {d.value === 'free' ? (
                <span>免费</span>
              ) : (
                <>
                  <Counter
                    value={d.value}
                    fontSize={56}
                    className={styles.big}
                  />
                  {d.unit && <span className={styles.unit}>{d.unit}</span>}
                </>
              )}
            </div>
            <p className={styles.sub}>{d.sub}</p>
          </AnimatedContent>
        ))}
      </div>
    </section>
  );
}