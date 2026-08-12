'use client';

import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import BlurText from '@/components/BlurText';
import DecryptedText from '@/components/DecryptedText';
import ShinyText from '@/components/ShinyText';
import SpecularButton from '@/components/SpecularButton';
import Counter from '@/components/Counter';
import AnimatedContent from '@/components/AnimatedContent';
import { useReducedMotion } from 'motion/react';
import styles from './Hero.module.css';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

const HERO_TITLE = '读完一句，写出来就是你的。';
const HERO_SUBTITLE = '读完一句是一句。语料横跨入门到雅思 4 个词库,807+ 句都是你的。';

// Hero 产品 UI mock 内部要演示「读 → 写 → 对」的一句话循环:
//   行 1:中文(BlurText 字母/字模糊入场 — 代表「读」)
//   行 2:英文(DecryptedText 字符还原 — 代表「写」)
//   行 3:✓(代表「对」)
const DEMO_LINE = { zh: '今天天气真好', en: "today's weather is nice" };

export default function Hero({ libs, onPickLib }: HeroProps) {
  const reduce = useReducedMotion();
  const { user } = useAuth();
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

  const libCount = libs.length;
  const totalSentences = libs.reduce((acc, l) => acc + (l.sentence_count ?? 0), 0);
  const totalWords = libs.reduce((acc, l) => acc + l.word_count, 0);

  return (
    <section id="hero" className={styles.bento} aria-label="产品介绍">
      <AnimatedContent distance={12} delay={0 / 1000} direction="vertical" className={styles.kickerRow}>
        <span className={styles.kickerBadge}>已上线 · 永久免费</span>
        <span className={styles.kickerDot} aria-hidden="true" />
        <span className={styles.kickerText}>
          {libCount} 词库 · {totalSentences.toLocaleString()}+ 句 · {totalWords.toLocaleString()} 词
        </span>
      </AnimatedContent>

      <div className={styles.bentoGrid}>
        <AnimatedContent distance={16} delay={100 / 1000} direction="vertical" className={styles.bentoLeft}>
          {/* shadcn ShinyText 不接 as prop(渲染硬写死 <motion.span>)。
              外层用 <h1> 包保留语义,className 透传到内层 span */}
          <h1 className={styles.title}>
            <ShinyText text={HERO_TITLE} speed={4} />
          </h1>
          <p className={styles.subtitle}>{HERO_SUBTITLE}</p>
          <div className={styles.heroCtaWrap}>
            <SpecularButton
              size="lg"
              onClick={handleStart}
              disabled={!canStart}
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
              {startLabel} →
            </SpecularButton>
          </div>
        </AnimatedContent>

        <AnimatedContent distance={20} delay={200 / 1000} direction="vertical" className={styles.bentoRight}>
          {/* 跟打 mock 卡:演示「读 → 写 → 对」一句话循环。
              复用 Hero.module.css 里既有的 .mock / .mockTopbar / .mockProgress /
              .mockZh / .mockTyping / .mockEn / .mockFooter / .mockStar /
              .mockCount / .mockCheck 整套样式(之前被 TiltedCard 占位图取代)。 */}
          <div className={styles.mock}>
            <div className={styles.mockTopbar}>
              <span className={styles.mockDot} />
              <span className={styles.mockDot} />
              <span className={styles.mockDot} />
              <span className={styles.mockLib}>{firstLib ? firstLib.name : '练习'}</span>
            </div>
            <div className={styles.mockProgress}>
              <span className={styles.mockProgressFill} style={{ width: '62%' }} />
            </div>

            {/* 读:中文模糊入场(BlurText) */}
            <div className={styles.mockPrompt}>
              {reduce ? (
                <span className={styles.mockZh}>{DEMO_LINE.zh}</span>
              ) : (
                <BlurText
                  text={DEMO_LINE.zh}
                  delay={120}
                  animateBy="letters"
                  direction="top"
                  stepDuration={0.4}
                  className={styles.mockZh}
                />
              )}
            </div>

            {/* 写:英文字符还原(DecryptedText) */}
            <div className={styles.mockTyping}>
              <span className={styles.mockEn}>
                {reduce ? (
                  DEMO_LINE.en
                ) : (
                  <DecryptedText
                    text={DEMO_LINE.en}
                    animateOn="view"
                    sequential
                    revealDirection="start"
                    speed={40}
                    maxIterations={8}
                  />
                )}
              </span>
            </div>

            {/* 对:收藏星 + 流程标签 + 勾 */}
            <div className={styles.mockFooter}>
              <span className={styles.mockStar} aria-hidden="true">
                ★
              </span>
              <span className={styles.mockCount}>读 → 写 → 对</span>
              <span className={styles.mockCheck} aria-hidden="true">
                ✓
              </span>
            </div>
          </div>

          <div className={styles.stats} role="list" aria-label="产品数据">
            <div className={styles.stat} role="listitem">
              <div className={styles.statNum}>
                <Counter value={libCount} fontSize={18} className={styles.statNum} />
              </div>
              <div className={styles.statLbl}>词库</div>
            </div>
            <div className={styles.stat} role="listitem">
              <div className={styles.statNum}>
                <Counter value={totalSentences} fontSize={18} className={styles.statNum} />
                <span className={styles.statPlus}>+</span>
              </div>
              <div className={styles.statLbl}>收录句数</div>
            </div>
            <div className={styles.stat} role="listitem">
              <div className={styles.statNum}>30s</div>
              <div className={styles.statLbl}>即可开始</div>
            </div>
          </div>
        </AnimatedContent>
      </div>
    </section>
  );
}
