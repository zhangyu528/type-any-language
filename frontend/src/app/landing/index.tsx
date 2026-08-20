'use client';

import { useEffect, type ReactElement } from 'react';
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
 *   - (无 — bg 在路由生命周期内常驻,2026-08 移除 IO unmount 修复
 *     resize 时 bg 消失的 bug;若要省 GPU,dark Galaxy 后续可单独按
 *     hero 观察再优化)
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
 * Decide what background to mount for the current theme. Returns:
 *   - `null`         → render the CSS fallback only (reduced-motion)
 *   - Galaxy tuning  → render <Galaxy />  (dark theme)
 *   - DotField tuning → render <DotField /> (light theme, Canvas 2D)
 *
 * 2026-08 简化:不再做 IO unmount,bg 在 LandingPage 路由生命周期内
 * 常驻 —— 之前 IO 观察整个 [data-landing-root] + resize 触发 reflow
 * 重算 intersection 导致 mounted 翻 false → bg 消失(用户报告
 * "resize 时 bg 没了")。light DotField (Canvas 2D) 不需要 GPU 节省,
 * dark Galaxy 跟随保留(真要省 GPU 可后续单独按 [hero] 优化)。
 *
 * Gating matrix (simplified):
 *   theme │ reducedMotion │ mount?
 *   ──────┼───────────────┼───────
 *   any   │ yes           │ no   (CSS only)
 *   light │ no            │ yes  (DotField, Canvas 2D)
 *   dark  │ no            │ yes  (Galaxy, WebGL)
 *
 * Plus a coarse small-screen gate (`< 720px`) — phones get the CSS
 * background regardless, since WebGL is overkill for a 360px-wide
 * screen and burns battery.
 */
function useLandingBackground(theme: 'light' | 'dark'): null | LandingBgTuning {
  const reduce = useReducedMotion();

  /* 2026-08 改:不再用 IntersectionObserver unmount。
     - light 用 Canvas 2D DotField,unmount 省不出多少 GPU,反而在
       resize 时因为 IO 观察整个 [data-landing-root] 重算 intersection
       把 mounted 翻成 false → DotField 整个消失 → "bg 没了"
     - dark Galaxy (WebGL) 理论上省 GPU 有意义,但 resize 同问题 +
       hook 删干净逻辑更直接;真要省可以后续按 [hero] 观察,目前
       不优化
     现在 bg 在 LandingPage 路由上常驻,靠 React unmount 整组件离开
     时才卸载。 */

  if (reduce) return null;
  if (theme === 'dark') {
    return { kind: 'galaxy', ...GALAXY_BY_THEME.dark };
  }
  /* light → Canvas 2D DotField dot grid + hover bulge(全页 hover
     跟手,与之前修过的 scroll offset 修复一起保留) */
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
              <a href="/" className={styles.footerBrandLink} aria-label="Type Any Language · 首页">
                <svg
                  className={styles.footerMark}
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--ds-action-deep)" />
                  <g fill="#fff">
                    {[8, 12, 16].flatMap((cy) =>
                      [8, 12, 16].map((cx) => (
                        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />
                      ))
                    )}
                  </g>
                </svg>
                <span className={styles.footerBrandName}>Type Any Language</span>
              </a>
              <p className={styles.footerTagline}>
                语言学习者 · 每天读完一句,就是你的。
              </p>
            </div>

            <div className={styles.footerCol}>
              <span className={styles.footerColLabel}>探索</span>
              <ul className={styles.footerLinks}>
                <li><a href="#how-it-works">怎么用</a></li>
                <li><a href="#lib-strip">词库</a></li>
                <li><a href="#data-bento">数据</a></li>
              </ul>
            </div>

            <div className={styles.footerCol}>
              <span className={styles.footerColLabel}>支持</span>
              <ul className={styles.footerLinks}>
                <li><a href="mailto:hi@type-any-language.dev">联系</a></li>
                <li><a href="mailto:hi@type-any-language.dev?subject=反馈">反馈</a></li>
              </ul>
            </div>

            <span className={styles.footerYear}>© 2026</span>
          </footer>
        </AnimatedContent>
      </div>


    </div>
  );
}