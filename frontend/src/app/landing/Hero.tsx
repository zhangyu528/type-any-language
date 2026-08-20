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
import AnimatedContent from '@/components/AnimatedContent';
import TypefallDemo from './TypefallDemo';
import LazySpecularButton from '@/components/LazySpecularButton';
import styles from './Hero.module.css';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  /** 通用转化 CTA:底部大按钮「注册·开始第一句」走这个,不带具体词库。 */
  onStartGeneric: () => void;
}

const HERO_TITLE = '读完一句，写出来就是你的。';
// 副标精简:核心 outcome(读完写出来) + 语料来源(4 词库);
// 详细数字已经在下方 stats + mock 卡 footnote,避免重复。
const HERO_SUBTITLE = '4 本词库 · 从入门到雅思,读完一句,写出来。';

// 信任承诺条 — 偏产品价值而不是营销口号,跟 hero 主题 "读完写出来" 呼应。
// "1 键开始" 太笼统,"30 秒上手" 难量化,改成具体可感的价值点。
const TRUST_BADGES: ReadonlyArray<{ icon: string; text: string }> = [
  { icon: '✓', text: '1 句 / 1 分钟' },
  { icon: '✓', text: '错词本自动攒' },
  { icon: '✓', text: '进度云端同步' },
];

export default function Hero({ libs, onStartGeneric }: HeroProps) {
  const { user } = useAuth();
  const firstLib = libs[0];
  const canStart = !!firstLib;

  const handleStart = () => {
    if (!canStart) return;
    onStartGeneric();
  };

  /* CTA 文案:未登录 "开始读第一句 →" (漏斗最顶,直接告诉产品用法),
     已登录 "继续读第一句 →" (有数据,鼓励立刻继续)。
     都用具体动词 + 名词,比单纯 "开始" / "开始学习" 更聚焦产品。 */
  const startLabel = user ? '继续读第一句' : '开始读第一句';

  return (
    <section id="hero" className={styles.bento} aria-label="产品介绍">

      {/* TITLE 区:主标题 + 副标,垂直居中,无 CTA。
         T2 决策(2026-08):title 上移到 demo 上方,作为第一眼门面。
         delay 0ms 紧接 AppHeader 的 200ms 入场,整段 hero ~620ms 就绪
         (之前 1.1s 偏慢,landing 第一屏要"快" — 错峰 0/100/200 缩到 ~0.62s)。 */}
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
        delay={100 / 1000}
        scale={0.94}
        direction="vertical"
        className={styles.demoBlock}
      >
        <div
          className={styles.mock}
          role="region"
          aria-label="产品演示 — 跟打练习微观动作"
        >
          <div className={styles.mockTopbar}>
            <span className={styles.mockDot} />
            <span className={styles.mockDot} />
            <span className={styles.mockDot} />
            <span className={styles.mockLib}>{firstLib ? firstLib.name : '练习'}</span>
          </div>

          {/* Hero 跟打练习微观动作演示 — 多句轮播 */}
          <TypefallDemo
            libId={firstLib?.id}
          />

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
          「前 3 块铺陈 → CTA 就绪」的阅读闭环。
          delay 200ms (从原 320ms 缩) 跟 demoBlock 错峰 ~100ms,
          整段 ~620ms 就位。 */}
      <AnimatedContent
        distance={12}
        delay={200 / 1000}
        direction="vertical"
        className={styles.heroBottomCta}
      >
        <LazySpecularButton
          placeholder={<span className={styles.bottomCtaBtn} aria-hidden="true" />}
          size="lg"
          onClick={handleStart}
          disabled={!canStart}
          /* 主 CTA 走品牌蓝(--ds-action-tint babyblue 极淡 wash);
             baseColor / lineColor / textColor 必须是字面 hex ——
             SpecularButton 把它们喂给 ogl WebGL shader,shader
             不解析 var()。#5BA8D8 = --ds-action(#8FCBF0) 与 --ds-action-deep
             (#2F80C0) 之间的中间蓝作 rim 基色;纯白 shine + 深蓝 text
             制造 Specular 高光感。(琥珀已收为 landing 单点转化色,
             仅 FinalCTA + LibStrip 推荐卡使用。) */
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
        </LazySpecularButton>
      </AnimatedContent>
    </section>
  );
}