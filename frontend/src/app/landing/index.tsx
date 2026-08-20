'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { useReducedMotion } from 'motion/react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useTheme } from '../components/ThemeProvider';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import LibStrip from './LibStrip';
import DataBento from './DataBento';
import FinalCTA from './FinalCTA';
import AnimatedContent from '@/components/AnimatedContent';
import styles from './index.module.css';

/* WebGL backgrounds are decorative — a CSS fallback (.landingBg)
   always renders behind them, and only ONE mounts per theme (dark→Galaxy,
   light→GradientWaves). Lazy-load both so `ogl` + the ~760 lines of shader
   code stay out of the landing's first-paint chunk. The CSS fallback covers
   the brief load, so no placeholder component is needed. */
const Galaxy = dynamic(() => import('@/components/Galaxy'), { ssr: false });
const DotField = dynamic(() => import('@/components/DotField'), { ssr: false });

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

/* Light theme DotField 配置 —— Canvas 2D 点阵 + hover bulge 互动,
   不用 WebGL (跟 Galaxy 的 ogl 解耦),Canvas 2D 在 light 主题 + 长时间
   动画时性能更稳。
   **配色层级**(从浅到深 → 视觉权重):
     - Hero bg:        --ds-bg           #F2F8FE    ← 浅 babyblue (基础底)
     - DotField bg:    gradient #5DA9D8 → #2F80C0  ← 中等 babyblue (点阵层)
     - DotField glow:  rgba(143,203,240,0.5)       ← ds-action 主蓝 (hover 高亮)
   DotField 用 gradient 当画布底色,所有点 fill = gradient,所以点
   颜色 = bg 颜色。比起 hero bg (#F2F8FE) 深 2-3 档,视觉"点阵浮在
   bg 之上"明显。鼠标 hover 时 bulge 偏亮 + glow 偏主蓝,跟 hero 文字
   层级清晰 (dot < 文字 < 主 CTA)。
   bulgeStrength 偏弱 (30) 不抢 hero 焦点,但 cursorRadius 220 让
   影响范围足够大,鼠标移动时 bulge 跟手明确。 */
const DOTFIELD_BY_THEME = {
  light: {
    gradientFrom: '#5DA9D8',
    gradientTo: '#2F80C0',
    dotRadius: 1.8,
    dotSpacing: 18,
    cursorRadius: 220,
    cursorForce: 0.15,
    bulgeStrength: 30,
    glowRadius: 60,
    glowColor: 'transparent',
    sparkle: true,
  },
};

type LandingBgTuning =
  | { kind: 'galaxy'; density: number; hueShift: number; speed: number; glowIntensity: number }
  | { kind: 'dotfield'; gradientFrom: string; gradientTo: string;
      dotRadius: number; dotSpacing: number; cursorRadius: number;
      cursorForce: number; bulgeStrength: number; glowRadius: number;
      glowColor: string; sparkle: boolean };

interface LandingPageProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  /** 词库卡点击(带具体词库,注册弹窗会显示"开始《X》")。 */
  onPickLib: (libId: string) => void;
  /** 通用转化 CTA(Hero / FinalCTA):不带具体词库,注册后由主页引导挑词库。 */
  onStartGeneric: () => void;
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
function useLandingBackground(theme: 'light' | 'dark'): null | LandingBgTuning {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(true);
  const rootRef = useRef<HTMLElement | null>(null);

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

  // WebGL gating matrix:
  //   - prefers-reduced-motion: on  → null (system opt-out)
  //   - hero out of viewport       → null (lazy; long landing saves GPU)
  //   - everything else             → mount WebGL on all viewports
  //
  // The old `max-width: 720px` gate is gone: viewport width is a poor
  // proxy for GPU horsepower, and modern phones render WebGL 2 fine.
  // Devices that truly can't handle it fall back to the browser's
  // built-in CSS path automatically.
  if (reduce) return null;
  if (!mounted) return null;
  if (theme === 'dark') {
    return { kind: 'galaxy', ...GALAXY_BY_THEME.dark };
  }
  /* light → GradientWaves,3 色按 sky / water / foam 语义对接调色板 */
  return { kind: 'dotfield', ...DOTFIELD_BY_THEME.light };
}

export default function LandingPage({
  libs,
  onPickLib,
  onStartGeneric,
}: LandingPageProps): ReactElement {
  /* 标记 html data-route="landing" —— 让 globals.css 把 body bg 设为 transparent,
     GradientWaves / Galaxy 的透明区域不再被不透明 body 遮住。 */
  useEffect(() => {
    document.documentElement.setAttribute(LANDING_ROUTE_ATTR, LANDING_ROUTE_VALUE);
    return () => {
      document.documentElement.removeAttribute(LANDING_ROUTE_ATTR);
    };
  }, []);

  const { theme } = useTheme();

  // Lazy WebGL bg — light → GradientWaves(波浪),dark → Galaxy(星空)。
  // Gate 同一套:reduced-motion off + viewport 可见 + ≥ 720px。
  const landingBg = useLandingBackground(theme === 'dark' ? 'dark' : 'light');

  return (
    <div className={styles.root} data-babyblue data-landing-root>
      {/* Background — Galaxy (WebGL, gated) OR CSS fallback (.landingBg).
         The CSS fallback is always present in the DOM; Galaxy is mounted
         on top when the hook returns a tuning. This keeps the visual
         continuous across theme switches and IO toggle boundaries. */}
      <div className={styles.landingBg} aria-hidden="true" />
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
      {landingBg?.kind === 'dotfield' ? (
        <div className={styles.landingBgGradientWaves} aria-hidden="true">
          <DotField
            gradientFrom={landingBg.gradientFrom}
            gradientTo={landingBg.gradientTo}
            dotRadius={landingBg.dotRadius}
            dotSpacing={landingBg.dotSpacing}
            cursorRadius={landingBg.cursorRadius}
            cursorForce={landingBg.cursorForce}
            bulgeStrength={landingBg.bulgeStrength}
            glowRadius={landingBg.glowRadius}
            glowColor={landingBg.glowColor}
            sparkle={landingBg.sparkle}
          />
        </div>
      ) : null}

      <div className={styles.content}>
        <Hero
          libs={libs}
          translationProgress={{}}
          onStartGeneric={onStartGeneric}
        />

        {/* SECTION 1: 读完一句如何记住 — 3 步拆解 */}
        <HowItWorks />

        {/* SECTION 2: 词库选择 — 真实 VocabularyLib[] 卡(DecryptedText + SpecularButton) */}
        <LibStrip libs={libs} onPickLib={onPickLib} />

        {/* SECTION 3: 数据 — 4 横排细竖线分隔(≥721px),数字进视口滚动计数 */}
        <DataBento libs={libs} />

        {/* SECTION 4: 收尾 CTA — DecryptedText 标题 + 单金属 SpecularButton「开始读第一句 →」 */}
        <FinalCTA onStart={onStartGeneric} />

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
            </div>

            <span className={styles.footerYear}>© 2026</span>
          </footer>
        </AnimatedContent>
      </div>


    </div>
  );
}