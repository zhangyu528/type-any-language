'use client';

/**
 * FinalCTA — 方案 A 简化版
 *
 * 之前:Threads + ShinyText + VariableProximity + Badge + SpecularButton
 * 现在:Threads + ShinyText + 单 SpecularButton — 删 VariableProximity
 *      (鼠标靠近变粗效果过载) + Badge "最后一步"(与其他 section 重复)。
 */

import { type ReactElement } from 'react';
import ShinyText from '@/components/ShinyText';
import SpecularButton from '@/components/SpecularButton';
import Threads from '@/components/Threads';
import AnimatedContent from '@/components/AnimatedContent';
import { useTheme } from '../components/ThemeProvider';
import styles from './FinalCTA.module.css';

interface FinalCTAProps {
  onStart: () => void;
}

const THREADS_LIGHT_RGB: [number, number, number] = [0x2f / 255, 0x80 / 255, 0xc0 / 255];
const THREADS_DARK_RGB: [number, number, number] = [143 / 255, 203 / 255, 240 / 255];

export default function FinalCTA({ onStart }: FinalCTAProps): ReactElement {
  const { theme } = useTheme();
  const threadsColor = theme === 'light' ? THREADS_LIGHT_RGB : THREADS_DARK_RGB;
  return (
    <section
      id="final-cta"
      className={styles.root}
      aria-labelledby="final-cta-title"
    >
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.bar}>
        <Threads
          className={styles.threadsBg}
          color={threadsColor}
          amplitude={0.8}
          distance={0.25}
          enableMouseInteraction={true}
        />

        <div className={styles.content}>
          <h2 id="final-cta-title" className={styles.title}>
            <ShinyText
              text="读完一句,就是你的"
              className={styles.titleMain}
              speed={3}
            />
            <span className={styles.titleArrow} aria-hidden="true">→</span>
          </h2>

          <SpecularButton
            type="button"
            size="lg"
            onClick={onStart}
            baseColor="#BA7517"
            lineColor="#ffffff"
            textColor="#412402"
            tint="#BA7517"
            tintOpacity={0.55}
            blur={16}
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