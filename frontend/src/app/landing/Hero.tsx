'use client';

/**
 * Hero — 首屏产品介绍。垂直堆叠布局 (2026-08 重设计,T2 调整):
 *
 *   [NavHeader (上方)]
 *   [title + subtitle]              ← 主标题,第一眼门面(T2:title 上移)
 *   [demo 卡 + trust 条]            ← 演示产品 + 信任承诺(已合并原 stats)
 *   [开始读第一句 →]                 ← 大 CTA 居中收尾
 *
 * Entrance 编排 (T2 · title-first):
 *
 *   t=0ms     titleBlock (title + subtitle)    slide-up 16px
 *             + ShinyText delay=0.5s:title ~0.4s 入场后开始 shimmer
 *             ← 第一眼门面:用户 0.3 秒看到「读完一句,写出来就是你的」
 *
 *   t=160ms   demoBlock (mock 卡 + trust 条)  scale 0.94→1 + slide-up 14px
 *             ← 演示产品 + 信任承诺(合并原 stats 的免登/1键/错自动),
 *               看完主标题马上接 demo「实际怎么做」
 *
 *   t=320ms   bottom CTA (开始读第一句 →)      slide-up 12px
 *             ← 收尾「现在可以开始了」转化锚点
 *
 *   总入场时长:~1.1s。垂直阅读路径,每步都有明确角色。
 *
 *   kicker 已删除(2026-08 T2 决策):旧"外语跟读 · 读 → 写 → 对"徽章
 *   跟 demo 卡下面的 trust 条信息重复(都讲方法论),删去简化层级,
 *   让 title 直接成为第一眼。demo 卡自身已经演示了「读 → 写 → 对」
 *   的具体动作,无需文字重复声明。
 */
import { useEffect, useRef, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import ShinyText from '@/components/ShinyText';
import SpecularButton from '@/components/SpecularButton';
import AnimatedContent from '@/components/AnimatedContent';
import TypefallDemo from './TypefallDemo';
import styles from './Hero.module.css';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

const HERO_TITLE = '读完一句，写出来就是你的。';
// 副标精简:核心 outcome(读完写出来) + 语料来源(4 词库);
// 详细数字已经在下方 stats + mock 卡 footnote,避免重复。
const HERO_SUBTITLE = '4 本词库 · 从入门到雅思,读完一句,写出来。';

// 信任承诺条 —— 原 hero 的 stats 行(免登/录即用、1 键/即开始、错自动/入错题本)
// 已合并进这里,统一为一条承诺,避免与 demo 下方信息重复、层级冗余。
const TRUST_BADGES: ReadonlyArray<{ icon: string; text: string }> = [
  { icon: '✓', text: '不需注册 · 打开即读' },
  { icon: '✓', text: '1 键开始 · 30 秒上手' },
  { icon: '✓', text: '错自动入错题本' },
];

export default function Hero({ libs, onPickLib }: HeroProps) {
  const { user } = useAuth();
  const firstLib = libs[0];
  const canStart = !!firstLib;
  // demo 句阶段:typing / done(dwell 期)。done 时 footer ★/✓ 点亮,
  // 跟 TypefallDemo 的 now 时间线联动,不另起定时器。
  const [demoPhase, setDemoPhase] = useState<'typing' | 'done'>('typing');
  // 逐词节拍计数器:每打完一个词 +1,作为外框呼吸脉冲的重放信号。
  const [wordBeat, setWordBeat] = useState(0);
  const beatRef = useRef<HTMLDivElement>(null);

  // 每打完一个词(wordBeat 变化)强制重放一次外框呼吸脉冲(beatPulse)。
  // 用 ref + 强制 reflow 重启动画,避免用 key 重挂导致的 "same key" 警告。
  useEffect(() => {
    if (wordBeat === 0) return;
    const el = beatRef.current;
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth; // 强制回流,让 animation 重置生效
    el.style.animation = '';
  }, [wordBeat]);

  const handleStart = () => {
    if (!canStart) return;
    onPickLib(firstLib.id);
  };

  const startLabel = firstLib
    ? user
      ? `继续读 · ${firstLib.name}`
      : '开始读第一句'
    : '暂无课程';

  return (
    <section id="hero" className={styles.bento} aria-label="产品介绍">

      {/* TITLE 区:主标题 + 副标,垂直居中,无 CTA。
         T2 决策(2026-08):title 上移到 demo 上方,作为第一眼门面。 */}
      <AnimatedContent
        distance={16}
        delay={0 / 1000}
        direction="vertical"
        className={styles.titleBlock}
      >
        <h1 className={styles.title}>
          <ShinyText text={HERO_TITLE} speed={4} delay={0.5} />
        </h1>
        <p className={styles.subtitle}>{HERO_SUBTITLE}</p>
      </AnimatedContent>

      <AnimatedContent
        distance={14}
        delay={160 / 1000}
        scale={0.94}
        direction="vertical"
        className={styles.demoBlock}
      >
        <div className={styles.mock}>
          {/* 逐词呼吸脉冲:每打完一个词 wordBeat +1 → 通过 beatRef 强制
             reflow 重放一次外框呼吸脉冲(beatPulse)。不用 key(避免 React
             "same key" 警告),改用 ref 重启动画。wordBeat>0 才渲染,
             避免加载时的多余脉冲。复用 TypefallDemo 的 now 时间线。
             句子完成后不再有新词 → 脉冲停在透明态,外框回归安静
             (满足"完成后就不需要触发了")。 */}
          {wordBeat > 0 && (
            <div ref={beatRef} className={styles.mockBeat} aria-hidden="true" />
          )}
          <div className={styles.mockTopbar}>
            <span className={styles.mockDot} />
            <span className={styles.mockDot} />
            <span className={styles.mockDot} />
            <span className={styles.mockLib}>{firstLib ? firstLib.name : '练习'}</span>
          </div>

          {/* Hero 跟打练习微观动作演示 — 多句轮播 */}
          <TypefallDemo
            libId={firstLib?.id}
            onPhase={setDemoPhase}
            onWord={() => setWordBeat((b) => b + 1)}
          />

          {/* mockFooter:动作提示,让用户知道这是可互动的 */}
          <div className={styles.mockFooter}>
            <span
              className={`${styles.mockStar}${demoPhase === 'done' ? ` ${styles.mockStarLit}` : ''}`}
              aria-hidden="true"
            >
              ★
            </span>
            <span className={styles.mockCount}>试读这一句 · 点击跟打</span>
            <span
              className={`${styles.mockCheck}${demoPhase === 'done' ? ` ${styles.mockCheckLit}` : ''}`}
              aria-hidden="true"
            >
              ✓
            </span>
          </div>
        </div>

        {/* Trust 条:demo 下方的小型承诺,跟 mock 卡视觉共生。
            跟 stats 的"心理安全"分工 —— 这条说"承诺",stats 说"具体数据"。 */}
        <ul className={styles.trustBadges} role="list" aria-label="使用承诺">
          {TRUST_BADGES.map((b) => (
            <li key={b.text} className={styles.trustBadgeItem}>
              <span className={styles.trustBadgeIcon} aria-hidden="true">
                {b.icon}
              </span>
              <span className={styles.trustBadgeText}>{b.text}</span>
            </li>
          ))}
        </ul>
      </AnimatedContent>

      {/* 底部 CTA:从原来"贴在 title 旁"挪到 hero 最底,作为整个 hero
          的转化锚点。单独 AnimatedContent 让它最后入场,变成
          「前 3 块铺陈 → CTA 就绪」的阅读闭环。 */}
      <AnimatedContent
        distance={12}
        delay={320 / 1000}
        direction="vertical"
        className={styles.heroBottomCta}
      >
        <SpecularButton
          size="lg"
          onClick={handleStart}
          disabled={!canStart}
          tint="var(--ds-action-tint)"
          tintOpacity={1}
          baseColor="#5BA8D8"
          lineColor="#FFFFFF"
          textColor="#0C2C53"
          blur={6}
          followMouse
          proximity={300}
          className={styles.bottomCtaBtn}
          aria-label={startLabel}
        >
          {startLabel} →
        </SpecularButton>
      </AnimatedContent>
    </section>
  );
}