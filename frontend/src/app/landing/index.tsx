'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { VocabularyLib, TranslationProgress } from '../api';
import Galaxy from '@/components/Galaxy';
import { useTheme } from '../components/ThemeProvider';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import LibStrip from './LibStrip';
import DataBento from './DataBento';
import FinalCTA from './FinalCTA';
import AnimatedContent from '@/components/AnimatedContent';
import styles from './index.module.css';

/**
 * Galaxy background tuning per theme. Light: gentle warm starfield
 * (hueShift 200 → mint/babyblue-leaning), low density, low glow.
 * Dark: deeper cool nebula (hueShift 210 → navy + accent), higher
 * density, more glow. Star rotation (0.1, 0) — slow X-axis drift,
 * never competes with content.
 *
 * Galaxy is only used in the dark theme now — light theme + reduced
 * motion + small screens render the CSS fallback in
 * `LandingBackground` (see ./index.module.css `.landingBg`). See the
 * `useLandingBackground` hook comment for the gating logic.
 */
const GALAXY_BY_THEME = {
  dark: { density: 1.2, hueShift: 210, speed: 0.5, glowIntensity: 0.5 },
};


interface LandingPageProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

/**
 * Decide whether to mount the heavy Galaxy WebGL canvas, and unmount
 * it when the hero scrolls out of view (saves GPU on long landing
 * pages with several sections). Returns:
 *   - `null`         → render the CSS fallback only
 *   - Galaxy tuning  → render <Galaxy /> (mounted = true means it's
 *                       currently in viewport, so safe to draw)
 *
 * Gating matrix:
 *   theme   │ reducedMotion │ viewport   │ mount?
 *   ─────────┼───────────────┼────────────┼─────────
 *   light   │ any           │ any        │ no  (CSS only)
 *   dark    │ yes           │ any        │ no  (CSS only)
 *   dark    │ no            │ not visible│ no  (lazy)
 *   dark    │ no            │ visible    │ yes (WebGL)
 *
 * Plus a coarse small-screen gate (`< 720px`) — phones get the CSS
 * background regardless, since WebGL is overkill for a 360px-wide
 * screen and burns battery.
 */
function useLandingBackground(theme: 'light' | 'dark'): null | { density: number; hueShift: number; speed: number; glowIntensity: number } {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(true);
  const [smallScreen, setSmallScreen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // Track viewport size (coarse gate).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 720px)');
    const sync = () => setSmallScreen(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);

  // Find the landing root once; IntersectionObserver watches it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = document.querySelector(`[data-landing-root]`) as HTMLElement | null;
    if (!el) return;
    rootRef.current = el;
    setMounted(true); // assume visible on first paint
    const io = new IntersectionObserver(
      ([entry]) => {
        setMounted(entry.isIntersecting);
      },
      { rootMargin: '120px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (theme !== 'dark') return null;
  if (reduce) return null;
  if (smallScreen) return null;
  if (!mounted) return null;
  return GALAXY_BY_THEME.dark;
}

export default function LandingPage({
  libs,
  onPickLib,
}: LandingPageProps): ReactElement {
  const firstLib = libs[0];
  const { theme } = useTheme();
  const handleStart = useCallback(() => {
    if (firstLib) onPickLib(firstLib.id);
  }, [firstLib, onPickLib]);

  // Lazy Galaxy — only mounts in dark theme + no reduced-motion +
  // visible viewport + ≥ 720px screen.
  const galaxyTuning = useLandingBackground(theme === 'dark' ? 'dark' : 'light');

  return (
    <div className={styles.root} data-babyblue data-landing-root>
      {/* Background — Galaxy (WebGL, gated) OR CSS fallback (.landingBg).
         The CSS fallback is always present in the DOM; Galaxy is mounted
         on top when the hook returns a tuning. This keeps the visual
         continuous across theme switches and IO toggle boundaries. */}
      <div className={styles.landingBg} aria-hidden="true" />
      {galaxyTuning ? (
        <div className={styles.landingBgGalaxy} aria-hidden="true">
          <Galaxy
            density={galaxyTuning.density}
            hueShift={galaxyTuning.hueShift}
            speed={galaxyTuning.speed}
            glowIntensity={galaxyTuning.glowIntensity}
            mouseInteraction={false}
            mouseRepulsion={false}
            twinkleIntensity={0.4}
            starSpeed={0.3}
            rotation={[0.1, 0.0]}
          />
        </div>
      ) : null}

      <div className={styles.content}>
        <Hero
          libs={libs}
          translationProgress={{}}
          onPickLib={onPickLib}
        />

        {/* SECTION 1: 读完一句如何记住 — 3 步拆解 */}
        <HowItWorks />

        {/* SECTION 3: 词库选择 — 真实 VocabularyLib[] 卡(DecryptedText + SpecularButton) */}
        <LibStrip libs={libs} onPickLib={onPickLib} />

        {/* SECTION 4: 数据 — 4 横排无装饰 AnimatedCounter */}
        <DataBento libs={libs} />

        {/* 收尾 CTA bar:DecryptedText 标题 + 单金属 SpecularButton「开始读」 */}
        <FinalCTA onStart={handleStart} />

        <AnimatedContent distance={16} delay={0 / 1000} direction="vertical" className={styles.footerWrap}>
          <footer className={styles.footer} aria-label="页脚">
            <div className={styles.footerBrand}>
              <span className={styles.footerBrandName}>Type Any Language</span>
              <ul className={styles.footerLinks}>
                <li>
                  <a href="mailto:hi@type-any-language.dev">联系</a>
                </li>
              </ul>
            </div>

            <div className={styles.footerMeta}>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>适用场景</span>
                <p className={styles.metaText}>
                  语言学习者 · 每天读完一句,就是你的。
                </p>
              </div>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>转化路径</span>
                <p className={styles.metaPath}>
                  <span className={styles.metaPathStep}>读一句</span>
                  <span className={styles.metaPathArrow}>→</span>
                  <span className={styles.metaPathStep}>写出来</span>
                  <span className={styles.metaPathArrow}>→</span>
                  <span className={styles.metaPathStep}>错改对</span>
                  <span className={styles.metaPathArrow}>→</span>
                  <span className={styles.metaPathStep}>记住</span>
                </p>
              </div>
            </div>

            <span className={styles.footerYear}>© 2026</span>
          </footer>
        </AnimatedContent>
      </div>


    </div>
  );
}