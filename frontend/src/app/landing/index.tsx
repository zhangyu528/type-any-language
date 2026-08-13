'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { VocabularyLib, TranslationProgress } from '../api';
import Galaxy from '@/components/Galaxy';
import GradientWaves from '@/components/GradientWaves';
import { useTheme } from '../components/ThemeProvider';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import LibStrip from './LibStrip';
import DataBento from './DataBento';
import FinalCTA from './FinalCTA';
import AnimatedContent from '@/components/AnimatedContent';
import styles from './index.module.css';

/* Landing 路由专属:html 标 data-route="landing" 让 globals.css 把 body bg
   设为 transparent,GradientWaves / Galaxy 的 transparent canvas 区域不再被
   不透明 body 覆盖。mounted 时设,unmount 时移除,跨路由切换干净。 */
const LANDING_ROUTE_ATTR = 'data-route';
const LANDING_ROUTE_VALUE = 'landing';
/**
 * Light / Dark 各挂不同 reactbits WebGL 组件 —— 同一套 gating(reduce-motion /
 * 小屏 / 视口可见),不同视觉:
 *   - Light → GradientWaves: 3 色控制(horizon / wave / crest),把 babyblue +
 *     coral 调色板拆成"sky / water / wave foam"语义。tilt 调小让波浪
 *     不抢 hero 焦点,opacity 0.7 让视觉重量平衡(波浪比极光更有"形")。
 *     horizon / wave / crest 默认 #5227FF / #FF9FFC / #FFFFFF(紫 + 品红 + 白),
 *     跟 babyblue 错位,这里覆盖。
 *   - Dark  → Galaxy: 星空 + 慢速旋转,navy + accent 高密度。
 *
 * 都进 CSS fallback(.landingBg)当:
 *   - reduced-motion 系统偏好打开
 *   - 视口不可见(IntersectionObserver,长 landing 页节省 GPU)
 *   - 屏幕 < 720px(WebGL 在小屏性价比差且费电)
 *
 * 详见 useLandingBackground hook 的 gating matrix。
 */
const GALAXY_BY_THEME = {
  dark: { density: 1.2, hueShift: 210, speed: 0.5, glowIntensity: 0.5 },
};

/* Light theme GradientWaves 配置 —— 3 色按"sky / water / wave foam"语义拆分,
   全部硬对接 babyblue + coral 调色板 */
const GRADIENT_WAVES_BY_THEME = {
  light: {
    horizonColor: '#CDEBFB',   /* 天空 —— 浅婴儿蓝(--ds-action-tint) */
    waveColor:    '#8FCBF0',   /* 水波 —— 婴儿蓝主调(--ds-action) */
    crestColor:    '#F4A6B0',   /* 浪尖 —— 软珊瑚高光(--ds-cta) */
    /* tilt 默认 1.11 波浪视角偏俯视,改 0.6 让波浪更"侧" ——
       模拟从远处看水面的扁平感,不抢 hero 焦点 */
    tilt: 0.6,
    speed: 0.3,              /* 慢速波浪,跟 hero 慢节奏打字对齐 */
    amplitude: 1.2,          /* 波幅压低 —— 默认 2.5 太"汹涌" */
    opacity: 0.7,            /* 整体不透明度,波浪形视觉重量 > 极光色带,必须压 */
    grain: false,            /* 关掉 grain,light 主题下噪点太重 */
    mouseInteraction: false, /* 关闭鼠标交互,跟 Galaxy 一致 */
  },
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
type LandingBgTuning =
  | { kind: 'galaxy'; density: number; hueShift: number; speed: number; glowIntensity: number }
  | { kind: 'gradientwaves'; horizonColor: string; waveColor: string; crestColor: string;
      tilt: number; speed: number; amplitude: number; opacity: number;
      grain: boolean; mouseInteraction: boolean };

function useLandingBackground(theme: 'light' | 'dark'): null | LandingBgTuning {
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

  if (reduce) return null;
  if (smallScreen) return null;
  if (!mounted) return null;
  if (theme === 'dark') {
    return { kind: 'galaxy', ...GALAXY_BY_THEME.dark };
  }
  /* light → GradientWaves,3 色按 sky / water / foam 语义对接调色板 */
  return { kind: 'gradientwaves', ...GRADIENT_WAVES_BY_THEME.light };
}

export default function LandingPage({
  libs,
  onPickLib,
}: LandingPageProps): ReactElement {
  /* 标记 html data-route="landing" —— 让 globals.css 把 body bg 设为 transparent,
     GradientWaves / Galaxy 的透明区域不再被不透明 body 遮住。 */
  useEffect(() => {
    document.documentElement.setAttribute(LANDING_ROUTE_ATTR, LANDING_ROUTE_VALUE);
    return () => {
      document.documentElement.removeAttribute(LANDING_ROUTE_ATTR);
    };
  }, []);

  const firstLib = libs[0];
  const { theme } = useTheme();
  const handleStart = useCallback(() => {
    if (firstLib) onPickLib(firstLib.id);
  }, [firstLib, onPickLib]);

  // Lazy WebGL bg — light → GradientWaves(波浪),dark → Galaxy(星空)。
  // Gate 同一套:reduced-motion off + viewport 可见 + ≥ 720px。
  const landingBg = useLandingBackground(theme === 'dark' ? 'dark' : 'light');

  return (
    <div className={styles.root} data-babyblue data-landing-root>
      {/* Background — Galaxy (WebGL, gated) OR CSS fallback (.landingBg).
         The CSS fallback is always present in the DOM; Galaxy is mounted
         on top when the hook returns a tuning. This keeps the visual
         continuous across theme switches and IO toggle boundaries. */}
      <div
        className={`${styles.landingBg} ${landingBg ? styles.landingBgHasWebGL : ''}`}
        aria-hidden="true"
      >
        {/* 6 个 1px 星点独立 twinkle —— 必须跟 nebula 分开 layer 才能各自动画 */}
        <div className={styles.stars} aria-hidden="true" />
      </div>
      {landingBg?.kind === 'galaxy' ? (
        <div className={styles.landingBgGalaxy} aria-hidden="true">
          <Galaxy
            density={landingBg.density}
            hueShift={landingBg.hueShift}
            speed={landingBg.speed}
            glowIntensity={landingBg.glowIntensity}
            mouseInteraction={false}
            mouseRepulsion={false}
            twinkleIntensity={0.4}
            starSpeed={0.3}
            rotation={[0.1, 0.0]}
          />
        </div>
      ) : null}
      {landingBg?.kind === 'gradientwaves' ? (
        <div className={styles.landingBgGradientWaves} aria-hidden="true">
          <GradientWaves
            horizonColor={landingBg.horizonColor}
            waveColor={landingBg.waveColor}
            crestColor={landingBg.crestColor}
            tilt={landingBg.tilt}
            speed={landingBg.speed}
            amplitude={landingBg.amplitude}
            opacity={landingBg.opacity}
            grain={landingBg.grain}
            mouseInteraction={landingBg.mouseInteraction}
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