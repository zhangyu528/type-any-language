'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import BrandMark from './BrandMark';
import styles from './Hero.module.css';
import PaperGrain from './PaperGrain';
import TypefallDemo from './TypefallDemo';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

const HERO_TITLE = '听一句，写一句，把英语练出肌肉记忆。';
const HERO_SUBTITLE = '语料取自日常场景，不是课本例句。';
// (chip / kicker / foot removed — see commit history for the trim log.)

export default function Hero({ libs, onPickLib }: HeroProps) {
  const [stage, setStage] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    const t0 = window.setTimeout(() => setStage(1), 0);     // demo in
    const t1 = window.setTimeout(() => setStage(2), 220);   // title chars
    const t2 = window.setTimeout(() => setStage(3), 880);   // subtitle + kicker
    const t3 = window.setTimeout(() => setStage(4), 1280);  // CTA + foot
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  // CTA: pick the first lib. Logged-out users go straight into
  // practice (LandingPage is guest-only; logged-in users are bounced
  // to /history by page.tsx before this component ever renders, so
  // we never need to branch on `user` here — but we still label the
  // CTA "开始今日练习 · X" when logged in, in case the redirect
  // hasn't landed yet during the first paint).
  const firstLib = libs[0];
  const canStart = !!firstLib;

  const handleStart = () => {
    if (!canStart) return;
    onPickLib(firstLib.id);
  };

  const startLabel = firstLib
    ? user
      ? `开始今日练习 · ${firstLib.name}`
      : '立即开始练习'
    : '暂无课程';

  return (
    <section className={styles.root} aria-label="产品介绍">
      {/* 背景层 —— 顶部薄荷光 + 纸纹颗粒,z-index 0,demo 在 z-index 1 之上 */}
      <PaperGrain />

      <div className={styles.inner}>
        {/* Stage 0: BrandMark with pulse — the product's "live"
            silhouette. Lives above the demo card and is the first
            thing the page reveals. Header chrome shows the same
            mark at 22px static; here at 72px with the centre dot
            pulsing 1.6s to convey "actively typing in your muscle
            memory". */}
        <div
          className={styles.brand}
          aria-hidden={stage < 1}
        >
          <BrandMark size={72} pulse />
        </div>

        {/* Stage 1: demo — the hero's centerpiece, fades in first */}
        <motion.div
          className={styles.demo}
          aria-hidden={stage < 1}
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={
            stage >= 1
              ? { opacity: 1, y: 0, scale: 1 }
              : { opacity: 0, y: 12, scale: 0.985 }
          }
          transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <div className={styles.demoCard}>
            <TypefallDemo />
          </div>
        </motion.div>

        {/* Stage 2: title fadeUp (brand caption removed — AppHeader
            already shows the brand mark + name on the same screen) */}
        <h1
          className={styles.title}
          aria-label={HERO_TITLE}
          aria-hidden={stage < 2}
        >
          {HERO_TITLE.split('').map((ch, i) => (
            <span
              key={i}
              className={styles.char}
              style={{
                animationDelay: `${i * 30}ms`,
                animationPlayState: stage >= 2 ? 'running' : 'paused',
              }}
              aria-hidden
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </h1>

        <div
          className={
            styles.rule + (stage >= 3 ? ` ${styles.ruleIn}` : '')
          }
          aria-hidden
        />

        {/* Stage 3: subtitle + kicker */}
        <p
          className={styles.subtitle + (stage >= 3 ? ` ${styles.subtitleIn}` : '')}
          aria-hidden={stage < 3}
        >
          {HERO_SUBTITLE}
        </p>

        {/* Stage 4: CTA + foot */}
        <motion.button
          type="button"
          className={styles.start}
          onClick={handleStart}
          aria-hidden={stage < 4}
          initial={{ opacity: 0, y: 8 }}
          animate={stage >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          whileHover={{ y: -2 }}
          whileTap={{ y: 0 }}
        >
          <span className={styles.startLabel}>{startLabel}</span>
          <span className={styles.startArrow} aria-hidden>→</span>
        </motion.button>
      </div>
    </section>
  );
}