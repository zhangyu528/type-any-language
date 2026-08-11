'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import {
  AnimatedCounter,
  BlurText,
  DecryptedText,
  ScrollReveal,
  ShinyText,
  SpecularButton,
} from '@/components/effects';
import { Badge } from '@/components/ui/badge';
import styles from './Hero.module.css';

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

// 一个小组件:挂载后等 N 毫秒才渲染子节点,用来给 DecryptedText 制造"按时间序列启动"的错觉。
function Delayed({ ms, children }: { ms: number; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}

// Hero demo — 3 行短语模拟「读完一句,写出来」的过程:
//   行 1:中文提示(BlurText 模糊渐入 — 代表「听 / 看」)
//   行 2:英文拼出(DecryptedText 字符随机化后还原 — 代表「写」)
//   行 3:✓  完成(DecryptedText 快速定型 — 代表「对」)
// 每一行按时间间隔 ~900ms 入场,形成「读 → 写 → 对」的视觉节奏。
const DEMO_LINES: Array<{
  zh: string;
  en: string;
  zhStartMs: number;
  enStartMs: number;
  checkStartMs: number;
}> = [
  { zh: '苹果',        en: 'apple',                       zhStartMs: 200,  enStartMs: 950,  checkStartMs: 1500 },
  { zh: '今天天气真好', en: "today's weather is nice",   zhStartMs: 1700, enStartMs: 2500, checkStartMs: 3200 },
  { zh: '我想点一杯拿铁', en: "i'd like a latte",          zhStartMs: 3500, enStartMs: 4300, checkStartMs: 5100 },
];

/**
 * Hero — 单屏 Bento(Q2 骨架)
 *
 * 业界标准重做(2026-08):从单条 `苹果 → apple` 升级为 3 行短语演示
 * (苹果 / 今天天气真好 / 我想点一杯拿铁) — 每行 stagger ~1.4s,模拟
 * 「读一句 → 写出来 → 记住」的完整过程。视觉编排:
 *
 *   top kicker:    Badge "已上线 · 永久免费"
 *   title block:   ShinyText h1 + 普通副标(进 hero 即入场)
 *   demo card:     BlurText 中文(模拟「读」)+ DecryptedText 英文(模拟「写」)
 *                  + DecryptedText 勾号(模拟「对」)— 时间序列 stagger
 *   stats:         3 个 AnimatedCounter(滚动到目标值)— startOnView
 *   CTA:           SpecularButton "开始读 →" (start once onView)
 *
 * 之前这版用了一个 414 行的 TypefallDemo(原生 <div> + CSS keyframe 打字机)。
 * 现在 3 行短语全部由 BlurText + DecryptedText 承载,统一在 react-bits 套件内。
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

  // stats 派生自现有 VocabularyLib 数据(现在用 AnimatedCounter 入场滚动):
  const libCount = libs.length;
  const totalSentences = libs.reduce((acc, l) => acc + (l.sentence_count ?? 0), 0);
  const totalWords = libs.reduce((acc, l) => acc + l.word_count, 0);
  const firstLibName = firstLib?.name ?? '—';

  return (
    <section id="hero" className={styles.bento} aria-label="产品介绍">
      {/* 顶部 kicker badge — 业界 hero 标配,放产品状态 + 信任标记 */}
      <ScrollReveal y={12} delay={0} className={styles.kickerRow}>
        <Badge variant="slate">已上线 · 永久免费</Badge>
        <span className={styles.kickerDot} aria-hidden="true" />
        <span className={styles.kickerText}>
          {libCount} 词库 · {totalSentences.toLocaleString()}+ 句 · {totalWords.toLocaleString()} 词
        </span>
      </ScrollReveal>

      <div className={styles.bentoGrid}>
        {/* 左半:标题区 */}
        <ScrollReveal y={16} delay={100} className={styles.bentoLeft}>
          <ShinyText
            as="h1"
            text={HERO_TITLE}
            className={styles.title}
            speed={4}
          />
          <p className={styles.subtitle}>{HERO_SUBTITLE}</p>
          <div className={styles.heroCtaWrap}>
            <SpecularButton
              size="lg"
              onClick={handleStart}
              disabled={!canStart}
              /* 实色填充(婴儿蓝)+ 深字 —— light/dark 都高对比 */
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
        </ScrollReveal>

        {/* 右半:demo 卡 + stats */}
        <ScrollReveal y={20} delay={200} className={styles.bentoRight}>
          <div className={styles.demoCard} aria-label="跟打示意:读中文,写英文">
            <div className={styles.demoHeader}>
              <span className={styles.demoKicker}>DEMO · 跟打三连</span>
              <span className={styles.demoLive} aria-hidden="true">
                <span className={styles.demoLiveDot} /> LIVE
              </span>
            </div>

            <div className={styles.demoLines}>
              {DEMO_LINES.map((line, i) => (
                <div key={i} className={styles.demoLine}>
                  <Delayed ms={line.zhStartMs}>
                    <BlurText
                      as="span"
                      text={line.zh}
                      className={styles.demoZh}
                      animateBy="characters"
                      direction="top"
                      stepDuration={0.32}
                      delay={45}
                    />
                  </Delayed>
                  <Delayed ms={line.enStartMs}>
                    <DecryptedText
                      text={`→ ${line.en}`}
                      speed={45}
                      maxIterations={6}
                      sequential
                      revealDirection="start"
                      className={styles.demoEn}
                    />
                  </Delayed>
                  <Delayed ms={line.checkStartMs}>
                    <DecryptedText
                      text="✓"
                      speed={120}
                      maxIterations={3}
                      className={styles.demoCheck}
                    />
                  </Delayed>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.stats} role="list" aria-label="产品数据">
            <div className={styles.stat} role="listitem">
              <div className={styles.statNum}>
                <AnimatedCounter value={libCount} startOnView duration={900} />
              </div>
              <div className={styles.statLbl}>词库</div>
            </div>
            <div className={styles.stat} role="listitem">
              <div className={styles.statNum}>
                <AnimatedCounter
                  value={totalSentences}
                  startOnView
                  duration={1400}
                />
                <span className={styles.statPlus}>+</span>
              </div>
              <div className={styles.statLbl}>收录句数</div>
            </div>
            <div className={styles.stat} role="listitem">
              <div className={styles.statName}>{firstLibName}</div>
              <div className={styles.statLbl}>入门词库</div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}