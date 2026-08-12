'use client';

/**
 * FinalCTA — 重设计收尾 CTA
 *
 * 之前:Threads(WebGL 流线)+ ShinyText + 单 SpecularButton。
 * 现在:去掉 Threads(重特效,与"单一 hover 微光"的签名冲突)和 ShinyText,
 *   标题改走 DecryptedText 字符还原(呼应全站"读出来"母题),配单金属
 *   SpecularButton「开始读」。背景沿用 css 主题感知玻璃条(--ds-tint-deep),
 *   不再需要 JS 读 theme。
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
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.bar}>
        <div className={styles.content}>
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
            tint="#8FCBF0"
            tintOpacity={1}
            baseColor="#5BA8D8"
            lineColor="#FFFFFF"
            textColor="#0C2C53"
            blur={8}
            followMouse
            proximity={300}
            className={styles.startBtn}
          >
            开始读
          </SpecularButton>
        </div>
      </AnimatedContent>
    </section>
  );
}
