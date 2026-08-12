'use client';

import { useEffect, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import BlurText from '@/components/BlurText';
import DecryptedText from '@/components/DecryptedText';
import ShinyText from '@/components/ShinyText';
import SpecularButton from '@/components/SpecularButton';
import TiltedCard from '@/components/TiltedCard';
import Counter from '@/components/Counter';
import AnimatedContent from '@/components/AnimatedContent';
import styles from './Hero.module.css';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

const HERO_TITLE = '读完一句，写出来就是你的。';
const HERO_SUBTITLE = '读完一句是一句。语料横跨入门到雅思 4 个词库,807+ 句都是你的。';

// Hero 产品 UI mock 内部要演示「读 → 写 → 对」的一句话循环:
//   行 1:中文(Blurred in — 代表「读」)
//   行 2:英文(字符随机化后还原 — 代表「写」)
//   行 3:✓(代表「对」)
const DEMO_LINE = { zh: '今天天气真好', en: "today's weather is nice" };

function Delayed({ ms, children }: { ms: number; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}

/**
 * Hero — 产品即 hero (方案 A)
 *
 * 业界参考:Linear / Framer 首页把产品 UI 直接放 hero(不是营销文案 + demo)。
 * 这里把跟打练习的核心 UI mock 出来,作为 hero 的右侧视觉锚点。
 *
 *   left column:
 *     - kickerRow: Badge "已上线 · 永久免费" + inline 统计
 *     - ShinyText h1 主标题
 *     - subtitle 一行
 *     - SpecularButton size="lg" 主 CTA
 *
 *   right column (TiltedCard 包 mock TranslationStage UI):
 *     - 顶部:词库名 + 进度条
 *     - 中部:中文提示 + 英文打字区(模拟) + 收藏星
 *     - 底部:行内「读 → 写 → 对」循环动画
 */
export default function Hero({ libs, onPickLib }: HeroProps) {
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
            <ShinyText
              text={HERO_TITLE}
              speed={4}
            />
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
          {/* shadcn TiltedCard 只接 imageSrc 渲染 <figure><img> —
              原 mock UI(跟打界面)整段删,改为占位图。3D 倾斜保留。 */}
          <TiltedCard
            containerHeight="auto"
            containerWidth="100%"
            rotateAmplitude={6}
            scaleOnHover={1.02}
            imageSrc="https://i.pravatar.cc/300?img=12"
            altText="跟打示意"
            captionText="跟打练习 · 实时演示"
            className={styles.mockCardWrap}
          />

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