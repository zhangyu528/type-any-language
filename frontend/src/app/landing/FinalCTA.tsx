'use client';

/**
 * FinalCTA — SECTION 4 收尾 CTA(full-bleed 范式,2026-08 重设计)
 *
 * 之前:glass bar(.bar 容器,backdrop-blur + border + shadow),本质是
 *      "另一种卡片",跟前面 4 个 section 的卡片形态同构。
 * 现在:full-bleed 段 — 整段 section 用全宽背景填充(类似 hero 的
 *      全屏开场),内容居中,**无 box 容器**,跟前面的卡片形态完全
 *      反差。视觉上"landing 起于 hero 开场,终于 FinalCTA 收尾",
 *      首尾对称。
 *
 * 跟之前版本的差异:
 *   - 删 .bar 容器(不再有 backdrop-blur / border / 多层 shadow)
 *   - .root 取消 max-width,全宽背景填满 viewport
 *   - 背景用渐变(浅薄荷 → 奶白 / 深空蓝 → 暗夜)
 *   - 内部 .contentWrap max-width 跟其他 section 一致
 *   - title 加大(28 → clamp 28-44),跟 hero 同一档视觉重量
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
          <span className={styles.titleArrow} aria-hidden="true">
            →
          </span>
        </h2>

        <SpecularButton
          type="button"
          size="lg"
          onClick={onStart}
          /* 紫色 CTA —— 跟 Section 2 featured 卡 + 数据 "免费" cell
             建立"紫色=转化"语义,full-bleed 段内仍是唯一视觉锚点。
             baseColor / lineColor / textColor 必须是字面 hex ——
             SpecularButton 把它们喂给 ogl WebGL shader,shader
             不解析 var()。这里 #7C3AED = --ds-convert-deep,作为
             紫色 rim 阴影环基色;纯白 shine + 白字配深紫底制造
             紫色系 Specular 高光感。 */
          tint="var(--ds-convert)"
          tintOpacity={1}
          baseColor="#7C3AED"
          lineColor="#FFFFFF"
          textColor="#FFFFFF"
          blur={8}
          followMouse
          proximity={300}
          className={styles.startBtn}
        >
          开始读
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