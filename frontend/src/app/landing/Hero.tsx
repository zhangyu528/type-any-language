'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import { ShinyText, SpecularButton, TiltedCard } from '@/components/effects';
import styles from './Hero.module.css';
import TypefallDemo from './TypefallDemo';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

// 文案对齐应用真实功能(2026-08-07 审计) + voice 重写(2026-08-07 下午)
// voice 锚:「读完一句,写出来就是你的」
//   - 动作统一用「读/写/记」,弃用「练」(太健身房)
//   - outcome 集中在 title,subtitle 给统计 + 同义复述
const HERO_TITLE = '读完一句，写出来就是你的。';
const HERO_SUBTITLE = '读完一句是一句。语料横跨入门到雅思 4 个词库,807+ 句都是你的。';

/**
 * Hero — 单屏 Bento(Q2 骨架)
 *   左半 (bentoLeft): 标题 + 副标 + kicker
 *   右半 (bentoRight): TiltedCard demo 卡 + 三块 stats (libs.length / sum word_count / libs[0].name)
 *   底部 (bentoCta): 深色横条 + SpecularButton 横跨整屏
 *   小屏 fallback: @media (max-width: 980px) 退化为单列垂直堆叠
 *
 * stats 数据全部从 props.libs 派生,无新增字段/无后端改动。
 * TiltedCard 保留在 demo 卡上 — 鼠标倾斜跟随动效不丢。
 * ShinyText 在浅/深 baby-blue 下用 `--shiny-base` / `--shiny-shine` token,组件默认值已就位。
 */
export default function Hero({ libs, onPickLib }: HeroProps) {
  const { user } = useAuth();
  // Stage gating for staggered entrance: demo first, then title, then subtitle, then CTA.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t0 = window.setTimeout(() => setStage(1), 0);     // demo in
    const t2 = window.setTimeout(() => setStage(3), 1400);   // title + subtitle
    const t3 = window.setTimeout(() => setStage(4), 1700);  // CTA + meta
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  const firstLib = libs[0];
  const canStart = !!firstLib;

  const handleStart = () => {
    if (!canStart) return;
    onPickLib(firstLib.id);
  };

  const startLabel = firstLib
    ? user
      ? `继续读 · ${firstLib.name}`
      : '开始读第一句'
    : '暂无课程';

  // stats 派生自现有 VocabularyLib 数据:
  //   - libs.length          : 词库总数
  //   - sum(libs.word_count) : 收录词数总和
  //   - libs[0]?.name        : 起步词库名(libs 按难度排序,libs[0] 是最浅的,
  //                            适合「入门」标签;不是「推荐」)
  const libCount = libs.length;
  const totalWords = libs.reduce((acc, l) => acc + l.word_count, 0);
  const firstLibName = firstLib?.name ?? '—';

  return (
    <section id="hero" className={styles.bento} aria-label="产品介绍">
      {/* 左半:标题区 */}
      <motion.div
        className={styles.bentoLeft}
        aria-hidden={stage < 3}
        initial={{ opacity: 0, y: 8 }}
        animate={stage >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <ShinyText
          as="h1"
          text={HERO_TITLE}
          className={styles.title}
          speed={4}
        />
        <p
          className={
            styles.subtitle + (stage >= 3 ? ` ${styles.subtitleIn}` : '')
          }
        >
          {HERO_SUBTITLE}
        </p>
      </motion.div>

      {/* 右半:demo 卡 + stats */}
      <motion.div
        className={styles.bentoRight}
        aria-hidden={stage < 1}
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={
          stage >= 1
            ? { opacity: 1, y: 0, scale: 1 }
            : { opacity: 0, y: 12, scale: 0.985 }
        }
        transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <TiltedCard
          containerHeight="auto"
          containerWidth="100%"
          rotateAmplitude={6}
          className={styles.demoCard}
        >
          <TypefallDemo />
        </TiltedCard>

        <div className={styles.stats} role="list" aria-label="产品数据">
          <div className={styles.stat} role="listitem">
            <div className={styles.statNum}>{libCount}</div>
            <div className={styles.statLbl}>词库</div>
          </div>
          <div className={styles.stat} role="listitem">
            <div className={styles.statNum}>{totalWords.toLocaleString()}</div>
            <div className={styles.statLbl}>收录词数</div>
          </div>
          <div className={styles.stat} role="listitem">
            <div className={styles.statName}>{firstLibName}</div>
            <div className={styles.statLbl}>入门词库</div>
          </div>
        </div>

        {/* CTA 按钮:放到右栏底部,作为 demo + stats 之后的转化锚点 */}
        <motion.div
          className={styles.bentoCta}
          aria-hidden={stage < 4}
          initial={{ opacity: 0, y: 8 }}
          animate={stage >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <SpecularButton
            size="lg"
            onClick={handleStart}
            disabled={!canStart}
            /* 实色填充(婴儿蓝)+ 深字 —— light/dark 都高对比;
               dashboard 的 SpecularButton 也用 tintOpacity={1} 给琥珀填充,
               统一模式:透明按钮在 dark 下会"深字在深底消失",必须给填充 */
            tint="#8FCBF0"
            tintOpacity={1}
            baseColor="#5BA8D8"
            lineColor="#FFFFFF"
            textColor="#0C2C53"
            blur={6}
            followMouse
            proximity={300}
            className={styles.ctaBtn}
          >
            开始读 →
          </SpecularButton>
        </motion.div>
      </motion.div>
    </section>
  );
}