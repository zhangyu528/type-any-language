'use client';

/**
 * HowItWorksSection — 方案 A 新增 SECTION 1
 *
 * "读完一句如何记住" — 3 步拆解(读 → 写 → 收藏):
 *   step 1 (大卡):中文提示 — BlurText 字符模糊渐入,代表「读」
 *   step 2 (小卡):英文跟打 — GlowCard 包裹,DecryptedText 字符随机化后还原,代表「写」
 *   step 3 (小卡):错题本 — SpotlightCard 包小型列表 mock,代表「收藏 + 复习」
 *
 * react-bits 角色分工:
 *   - BlurText        → step 1 主视觉
 *   - GlowCard        → step 2 容器(hover 时微光,提示"这是活动的")
 *   - DecryptedText   → step 2 实时演示字符还原
 *   - SpotlightCard   → step 3 容器(光标跟随 spotlight,给列表一种"打光"感)
 *
 * Grid 排版:bento 风格 1 大 2 小,大卡占两行,两个小卡垂直堆叠占两列。
 * AnimatedContent 让三个卡按 80ms / 240ms / 400ms 顺序入场。
 */

import BlurText from '@/components/BlurText';
import DecryptedText from '@/components/DecryptedText';
import SpotlightCard from '@/components/SpotlightCard';
import BorderGlow from '@/components/BorderGlow';
import AnimatedContent from '@/components/AnimatedContent';
import styles from './HowItWorks.module.css';

const STEP1_ZH = '今天天气真好';
const STEP2_EN = "today's weather is nice";

interface HowItWorksProps {
  className?: string;
}

export default function HowItWorks(_props: HowItWorksProps) {
  return (
    <section className={styles.root} aria-labelledby="how-it-works-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 1 · 读完一句如何记住</p>
        <h2 id="how-it-works-title" className={styles.title}>
          读、写、收。三步构成一句。
        </h2>
      </AnimatedContent>

      <div className={styles.grid}>
        {/* step 1 (大卡):中文提示 — BlurText 模糊渐入 */}
        <AnimatedContent distance={24} delay={80 / 1000} direction="vertical" className={styles.stepLarge}>
          <div className={styles.cardLarge}>
            <span className={styles.stepLabel}>STEP 1 · 读</span>
            <BlurText
              as="p"
              text={STEP1_ZH}
              className={styles.zh}
              animateBy="characters"
              direction="top"
              stepDuration={0.4}
              delay={50}
            />
            <p className={styles.cardSub}>每句给一个中文提示 — 像一句话。</p>
          </div>
        </AnimatedContent>

        {/* step 2 (小卡):英文跟打 — GlowCard + DecryptedText */}
        <AnimatedContent distance={24} delay={240 / 1000} direction="vertical" className={styles.stepSmall}>
          <BorderGlow glowRadius={36} glowColor="143, 203, 240" glowIntensity={1.0} className={styles.cardGlowWrap}>
            <div className={styles.cardSmall}>
              <span className={styles.stepLabel}>STEP 2 · 写</span>
              <div className={styles.enBox}>
                <DecryptedText
                  text={`→ ${STEP2_EN}`}
                  speed={45}
                  maxIterations={6}
                  sequential
                  revealDirection="start"
                  className={styles.en}
                />
              </div>
              <p className={styles.cardSub}>
                字母按字随机化后逐字还原 — 模拟你「打出来」的过程。
              </p>
            </div>
          </BorderGlow>
        </AnimatedContent>

        {/* step 3 (小卡):错题本 — SpotlightCard */}
        <AnimatedContent distance={24} delay={400 / 1000} direction="vertical" className={styles.stepSmall}>
          <SpotlightCard
            spotlightColor="143, 203, 240"
            className={styles.cardSpotlightWrap}
          >
            <div className={styles.cardSmall}>
              <span className={styles.stepLabel}>STEP 3 · 收</span>
              <div className={styles.list}>
                <div className={styles.listRow}>
                  <span className={styles.listTag}>☆</span>
                  <span className={styles.listEn}>apple</span>
                  <span className={styles.listZh}>苹果</span>
                </div>
                <div className={styles.listRow}>
                  <span className={styles.listTag}>☆</span>
                  <span className={styles.listEn}>latte</span>
                  <span className={styles.listZh}>拿铁</span>
                </div>
                <div className={styles.listRow}>
                  <span className={styles.listTag}>☆</span>
                  <span className={styles.listEn}>weather</span>
                  <span className={styles.listZh}>天气</span>
                </div>
              </div>
              <p className={styles.cardSub}>点 ☆ 收藏。错过的进错题本。</p>
            </div>
          </SpotlightCard>
        </AnimatedContent>
      </div>
    </section>
  );
}