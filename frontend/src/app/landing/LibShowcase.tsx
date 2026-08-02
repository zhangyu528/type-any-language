'use client';

/**
 * LibShowcase — 04 · 学什么 词库橱窗
 *
 * 数据驱动:消费 pickCarouselLibs(libs) 选 3 张词库卡。
 * 整卡可点 CTA,跳到对应词库练习 (?lib=X)。
 * 桌面三列;移动端横滑 scroll-snap-x(首屏显示拖动提示)。
 *
 * 视觉:等级 Badge + 库名(衬线大字) + 词数/句数 stat +
 * 简介(2 行 clamp) + 底部"开始 →" 整行可点。
 *
 * 不显示个人进度(回访用户的"继续上次"放在主导航/AppHeader,
 * 不到 Landing 这个营销页抢戏)。
 */

import { motion } from 'motion/react';
import { VocabularyLib } from '../api';
import { pickCarouselLibs } from './data';
import { riseIn, staggerParent, spring } from '../ds/motion';
import styles from './LibShowcase.module.css';

interface LibShowcaseProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

const SECTION_ID = 'lib-showcase';

export default function LibShowcase({ libs, onPickLib }: LibShowcaseProps) {
  const showcase = pickCarouselLibs(libs);

  return (
    <section
      id={SECTION_ID}
      className={styles.root}
      aria-labelledby="lib-showcase-title"
    >
      <motion.header
        className={styles.header}
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-15% 0px' }}
      >
        <motion.p className={styles.kicker} variants={riseIn}>
          04 · 学什么
        </motion.p>
        <motion.h2
          id="lib-showcase-title"
          className={styles.title}
          variants={riseIn}
        >
          从一份词库开始
        </motion.h2>
        <motion.p className={styles.subtitle} variants={riseIn}>
          覆盖四六级、雅思、日常口语。点哪张,就从哪张开始。
        </motion.p>
      </motion.header>

      <motion.ol
        className={styles.cards}
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-10% 0px' }}
      >
        {showcase.map((lib, i) => (
          <motion.li
            key={lib.id}
            className={styles.cardItem}
            variants={riseIn}
            transition={spring.overshoot}
          >
            <button
              type="button"
              className={styles.card}
              onClick={() => onPickLib(lib.id)}
              aria-label={`开始 ${lib.name} 词库,${lib.word_count} 词 ${lib.level}`}
            >
              <span className={styles.badge}>{lib.level.toUpperCase()}</span>

              <h3 className={styles.libName}>{lib.name}</h3>

              <p className={styles.libMeta}>
                <span className={styles.metaNum}>
                  {lib.word_count.toLocaleString()}
                </span>{' '}
                词
              </p>

              <p className={styles.libDesc}>
                {lib.description ?? '从这一份开始,逐字练。'}
              </p>

              <span className={styles.cta} aria-hidden>
                <span className={styles.ctaLabel}>开始这个词库</span>
                <span className={styles.ctaArrow}>→</span>
              </span>
            </button>
          </motion.li>
        ))}
      </motion.ol>

      {/* 移动端拖动提示,3s 后淡出 */}
      <p className={styles.dragHint} aria-hidden>
        ← 拖动浏览 →
      </p>
    </section>
  );
}
