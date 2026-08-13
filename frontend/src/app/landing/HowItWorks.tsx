'use client';

/**
 * HowItWorksSection — SECTION 1（读 → 写 → 记 三步时间轴）
 *
 * 3 步用同一句例句「今天天气真好 / today's weather is nice」演示:
 *   - step 1 读:中文 BlurText 模糊渐入(给中文提示)
 *   - step 2 写:英文 LetterReveal 逐字 fade-in(参考 hero TypefallDemo)
 *   - step 3 记:3 个数字 mini-stats(今日 / 本周 / 累计),在 demoBox 内 inline 排列,跟 Step 1/2 同形
 *
 * react-bits 角色分工:
 *   - BlurText        → step 1 主视觉
 *   - BorderGlow      → step 2 容器(光标微光,改用婴儿蓝色)
 *   - LetterReveal    → step 2 逐字 fade-in(参考 hero TypefallDemo)

 *
 * Grid 排版:3 列等宽 + 卡间 ::after 渐变线 + → 箭头连接。
 * 全部 hero 居中风格一致:.header / .kicker / .title 居中,kicker 装饰线清理。
 * AnimatedContent 让 3 个卡按 80ms / 240ms / 400ms 顺序入场。
 */

import { useEffect, useState } from 'react';
import BlurText from '@/components/BlurText';
import LetterReveal from './LetterReveal';
import BorderGlow from '@/components/BorderGlow';
import AnimatedContent from '@/components/AnimatedContent';
import styles from './HowItWorks.module.css';

/** 循环高亮每步停留时长(ms)。2.2s 让每张卡内容可读,
 *  整圈 01→02→03 ≈ 6.6s,节奏从容不抢戏。 */
const STEP_DWELL_MS = 2200;
const STEP_COUNT = 3;

const STEP1_ZH = '今天天气真好';
const STEP2_EN = "today's weather is nice";

/** Step 3 数字卡——展示「学完能看见什么」,而不是「看到哪些词」。
 *  数字本身不需要后端,展示合理示例值即可(今日/本周/累计 递增,跟产品口径一致)。 */
const STEP3_STATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1',  label: '今日' },
  { value: '7',  label: '本周' },
  { value: '28', label: '累计' },
];

interface HowItWorksProps {
  className?: string;
}

export default function HowItWorks(_props: HowItWorksProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // 跟随系统"减少动态"偏好:开启时关闭循环高亮(不 dim、不循环)。
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 自动循环高亮:每 STEP_DWELL_MS 切到下一步;hover 时暂停(由 paused 控制)。
  useEffect(() => {
    if (paused || reduceMotion) return;
    const id = setInterval(() => {
      setActiveStep((s) => (s + 1) % STEP_COUNT);
    }, STEP_DWELL_MS);
    return () => clearInterval(id);
  }, [paused, reduceMotion]);

  // 非 active 卡降透明度让当前步"跳"出来;reduceMotion 时全部平权。
  const cardClass = (idx: number) => {
    if (reduceMotion) return styles.card;
    return `${styles.card} ${activeStep === idx ? styles.cardActive : styles.cardDim}`;
  };
  const enter = (idx: number) => () => {
    setPaused(true);
    setActiveStep(idx);
  };
  const leave = () => setPaused(false);

  return (
    <section id="how-it-works" className={styles.root} aria-labelledby="how-it-works-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 1 · 读完一句如何记住</p>
        <h2 id="how-it-works-title" className={styles.title}>
          读、写、记。三步构成一句。
        </h2>
      </AnimatedContent>

      {/* 时间轴横排:3 卡等宽,卡间 ::after 画 → 箭头连接线 */}
      <ol className={styles.timeline}>
        {/* step 1:中文提示 — BlurText 模糊渐入 */}
        <AnimatedContent
          distance={24}
          delay={80 / 1000}
          direction="vertical"
          className={`${styles.stepTimeline} ${styles.stepFirst}`}
        >
          <BorderGlow
            glowRadius={36}
            glowColor="143 203 240"
            glowIntensity={0.9}
            colors={['var(--ds-action-tint)', '#5BA8D8', '#2F80C0']}
            backgroundColor="transparent"
            borderRadius={28}
            fillOpacity={0.2}
            className={styles.cardGlowWrap}
          >
          <div
            className={cardClass(0)}
            onMouseEnter={enter(0)}
            onMouseLeave={leave}
          >
            <span className={styles.stepNumber}>01</span>
            <span className={styles.stepLabel}>读</span>
            <div className={styles.demoBox}>
              <BlurText
                text={STEP1_ZH}
                className={styles.zh}
                animateBy="letters"
                direction="top"
                stepDuration={0.4}
                delay={50}
              />
            </div>
            <p className={styles.cardSub}>中文点拨在先,你心里先有数。</p>
          </div>
          </BorderGlow>
        </AnimatedContent>

        {/* step 2:英文跟打 — BorderGlow(改婴儿蓝,跟全局统一) + LetterReveal */}
        <AnimatedContent
          distance={24}
          delay={240 / 1000}
          direction="vertical"
          className={styles.stepTimeline}
        >
          <BorderGlow
            glowRadius={36}
            /* 原红 203 76 75 是 dead code(被 css-module !important 清掉),
               改用婴儿蓝主题色 + 全透明背景,只保留光标微光 */
            glowColor="143 203 240"
            glowIntensity={0.9}
            colors={['var(--ds-action-tint)', '#5BA8D8', '#2F80C0']}
            backgroundColor="transparent"
            borderRadius={28}
            fillOpacity={0.2}
            className={styles.cardGlowWrap}
          >
            <div
              className={cardClass(1)}
              onMouseEnter={enter(1)}
              onMouseLeave={leave}
            >
              <span className={styles.stepNumber}>02</span>
              <span className={styles.stepLabel}>写</span>
              <div className={styles.demoBox}>
                <LetterReveal
                  text={STEP2_EN}
                  charStaggerMs={120}
                />
              </div>
              <p className={styles.cardSub}>逐字浮现,每键你都确认。</p>
            </div>
          </BorderGlow>
        </AnimatedContent>

        {/* step 3:学完能看到的数据 — 数字卡(B 方案)。
           替代原"3 行收藏词",视觉权重从 footnote 提升到 step 级。 */}
        <AnimatedContent
          distance={24}
          delay={400 / 1000}
          direction="vertical"
          className={`${styles.stepTimeline} ${styles.stepLast}`}
        >
          <BorderGlow
            glowRadius={36}
            glowColor="143 203 240"
            glowIntensity={0.9}
            colors={['var(--ds-action-tint)', '#5BA8D8', '#2F80C0']}
            backgroundColor="transparent"
            borderRadius={28}
            fillOpacity={0.2}
            className={styles.cardGlowWrap}
          >
          <div
            className={cardClass(2)}
            onMouseEnter={enter(2)}
            onMouseLeave={leave}
          >
              <span className={styles.stepNumber}>03</span>
              <span className={styles.stepLabel}>记</span>
              <div className={styles.demoBox}>
                <ul className={styles.step3Stats} role="list" aria-label="今日 / 本周 / 累计 句数">
                  {STEP3_STATS.map((s) => (
                    <li key={s.label} className={styles.step3Stat}>
                      <span className={styles.stepStatValue}>{s.value}</span>
                      <span className={styles.stepStatLabel}>{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className={styles.cardSub}>打过的词会反复出现,直到稳。</p>
            </div>
          </BorderGlow>
        </AnimatedContent>
      </ol>
    </section>
  );
}