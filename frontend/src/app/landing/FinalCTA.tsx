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
import SpecularButton from '@/components/SpecularButton';
import AnimatedContent from '@/components/AnimatedContent';
import { useReducedMotion } from 'motion/react';
import styles from './FinalCTA.module.css';

interface FinalCTAProps {
  onStart: () => void;
}

export default function FinalCTA({ onStart }: FinalCTAProps): ReactElement {
  const reduce = useReducedMotion();
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

        <SpecularButton
          type="button"
          size="lg"
          onClick={onStart}
          /* cta 琥珀 CTA —— 与 Section 2 featured 卡按钮一致,
             full-bleed 段内仍是唯一视觉锚点。
             baseColor / lineColor / textColor 必须是字面 hex ——
             SpecularButton 把它们喂给 ogl WebGL shader,shader
             不解析 var()。这里 #EFA535 = --ds-cta(暗主题琥珀),作为
             琥珀 rim 阴影环基色;纯白 shine + 白字配深琥珀底制造
             琥珀系 Specular 高光感。 */
          tint="var(--ds-cta)"
          tintOpacity={1}
          baseColor="#EFA535"
          lineColor="#FFFFFF"
          textColor="#FFFFFF"
          blur={8}
          followMouse
          proximity={300}
          className={styles.startBtn}
        >
          开始读第一句 →
        </SpecularButton>

        {/* 次级动作:不想立即开始的用户的第二个出口 —— 跳到
           #lib-strip 看完整词库选择。mono + 婴儿蓝,弱化但不淹没。 */}
        <a className={styles.secondaryLink} href="#lib-strip">
          先看看完整词库 <span aria-hidden="true">→</span>
        </a>
      </AnimatedContent>
    </section>
  );
}