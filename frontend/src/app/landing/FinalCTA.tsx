'use client';

/**
 * FinalCTA — SECTION 4 收尾 CTA(2026-08 重设计)
 *
 * 设计:透明 bg 的普通 section(非 full-bleed),跟 hero 靠"背景透出"
 *      对偶 —— landing 起于 hero(背景透出 + 中央内容),终于 FinalCTA
 *      (同样背景透出 + 中央内容),中间 3 个 section 是 frosted 卡片。
 *      不再有 .bar 玻璃容器(无 backdrop-blur / border / 多层 shadow),
 *      避免跟前面 section 的卡片形态同构。
 *
 * CTA 文案约定(Hero 同源):用"具体动词 + 名词" ——「开始读第一句 →」,
 *   不用裸「开始」。箭头放在按钮内(Hero 同款),标题不放悬空箭头。
 *
 * 差异点 vs 之前:
 *   - 删 .bar 容器
 *   - .root 透明 bg,GradientWaves / Galaxy 透出
 *   - 内部 .contentWrap max-width 跟其他 section 一致
 *   - title 加大(clamp 28-44),跟 hero 同一档视觉重量
 */

import { type ReactElement } from 'react';
import DecryptedText from '@/components/DecryptedText';
import { useTheme } from '../components/ThemeProvider';
import AnimatedContent from '@/components/AnimatedContent';
import { useReducedMotion } from 'motion/react';
import LazySpecularButton from '@/components/LazySpecularButton';
import styles from './FinalCTA.module.css';

interface FinalCTAProps {
  onStart: () => void;
}

export default function FinalCTA({ onStart }: FinalCTAProps): ReactElement {
  const reduce = useReducedMotion();
  const { theme } = useTheme();
  // 主转化色:亮=深紫,暗=琥珀(琥珀原为唯一色,亮下太接近 babyblue
  // 母题调性,改成紫色更"反差"且白字对比度从 3.72:1 → 8.08:1)
  const ctaFill = theme === 'dark' ? 'var(--ds-cta)' : 'var(--ds-convert-deep)';
  // rim 阴影环:比 fill 再深一档 —— 之前 baseColor 写死 #EFA535,
  // 暗主题等于 fill 看不到环,亮主题反而比 fill 亮(rim 不是 rim)
  const rimBase = theme === 'dark' ? '#854F0B' : '#4C1D95';
  // 按钮字色:暗=深咖 #412402(= --ds-on-cta,亮琥珀底上白字仅 2.08:1 不达标,
  // 深咖 6.84:1 达标);亮=白字(深紫底 8.08:1 达标)。
  const ctaText = theme === 'dark' ? '#412402' : '#FFFFFF';
  return (
    <section id="final-cta" className={styles.root} aria-labelledby="final-cta-title">
      <AnimatedContent
        distance={20}
        delay={0 / 1000}
        direction="vertical"
        className={styles.contentWrap}
      >
        <h2 id="final-cta-title" className={styles.title}>
          {reduce ? (
            <span className={styles.titleMain}>读完一句，就是你的</span>
          ) : (
            <DecryptedText
              text="读完一句，就是你的"
              animateOn="view"
              sequential
              revealDirection="start"
              speed={40}
              maxIterations={10}
              className={styles.titleMain}
            />
          )}
        </h2>

        <LazySpecularButton
          placeholder={<span className={styles.startBtn} aria-hidden="true" />}
          type="button"
          size="lg"
          onClick={onStart}
          /* 主转化 CTA(2026-08 改):
             - 亮主题:紫色 --ds-convert-deep (#6D28D9) 替代琥珀
               ——白字 8.08:1 过 WCAG AA Normal;视觉上"冷蓝母题
               + 紫主转化 + 蓝冷次转化"三层冷调,跟 babyblue 主调
               一脉相承(原琥珀是"反面色",跟冷调母题割裂)。
             - 暗主题:琥珀 --ds-cta (#EFA535) 保留 —— 暗主题走
               dashboard 同款暖系,亮紫→暗琥珀切换是预期的视觉锚。
             baseColor / lineColor / textColor 必须是字面 hex ——
             SpecularButton 把它们喂给 ogl WebGL shader,shader
             不解析 var()。rim 走"比 fill 深一档":
               亮 #4C1D95 / 暗 #854F0B ——真阴影环(之前 rim == fill
               暗主题看不到边,亮主题 rim 还比 fill 亮方向反了)。
             纯白 shine 通用,白字配深紫/深琥珀底统一 Specular 高光感。 */
          tint={ctaFill}
          tintOpacity={1}
          baseColor={rimBase}
          lineColor="#FFFFFF"
          textColor={ctaText}
          blur={8}
          followMouse
          proximity={300}
          className={styles.startBtn}
        >
          开始读第一句 →
        </LazySpecularButton>

        {/* 次级动作:不想立即开始的用户的第二个出口 —— 跳到
           #lib-strip 看完整词库选择。mono + 婴儿蓝,弱化但不淹没。 */}
        <a className={styles.secondaryLink} href="#lib-strip">
          先看看完整词库 <span aria-hidden="true">→</span>
        </a>
      </AnimatedContent>
    </section>
  );
}