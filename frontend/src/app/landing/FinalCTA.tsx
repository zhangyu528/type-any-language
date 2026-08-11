'use client';

/**
 * FinalCTA — 方案 B 黑色 CTA bar
 *
 * 与方案 B 草图一致:深色反色块 + 横向 layout。
 * 左侧大标题"选个场景试试 →",右侧琥珀色 SpecularButton。
 * 背景走 React Bits <Threads> WebGL 流线,与登录/注册
 * 同一套视觉语言。
 */

import { type ReactElement } from 'react';
import { motion } from 'motion/react';
import { SpecularButton, Threads, VariableProximity } from '@/components/effects';
import { spring } from '../ds/motion';
import styles from './FinalCTA.module.css';
import { useTheme } from '../components/ThemeProvider';

interface FinalCTAProps {
  onStart: () => void;
}

// ogl Color 期望 0..1 浮点三元组。
//   浅色: --ds-action-deep (#2F80C0) — 深一档的 baby blue,
//          配 multiply 混合"印"在 tint 底色上更显眼
//   深色: baby blue 原色 (#8FCBF0) — 配 screen 混合在深空蓝底上更亮
const THREADS_LIGHT_RGB: [number, number, number] = [0x2f / 255, 0x80 / 255, 0xc0 / 255];
const THREADS_DARK_RGB: [number, number, number] = [143 / 255, 203 / 255, 240 / 255];

export default function FinalCTA({ onStart }: FinalCTAProps): ReactElement {
  const { theme } = useTheme();
  // ME-Q4: thread color depends on theme — dark in light mode so
  // multiply blend "印" them visibly on the light-tint bar; baby
  // blue in dark mode so screen blend "lights" them up on navy.
  const threadsColor = theme === 'light' ? THREADS_LIGHT_RGB : THREADS_DARK_RGB;
  return (
    <section
      id="final-cta"
      className={styles.root}
      aria-labelledby="final-cta-title"
    >
      <motion.div
        className={styles.bar}
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={spring.soft}
      >
        <Threads
          className={styles.threadsBg}
          color={threadsColor}
          amplitude={0.8}
          distance={0.25}
          enableMouseInteraction={true}
        />

        <div className={styles.content}>
          <div className={styles.titleBlock}>
            <h2 id="final-cta-title" className={styles.title}>
              <span className={styles.titleMain}>读完一句,就是你的</span>
              <span className={styles.titleArrow} aria-hidden="true">
                →
              </span>
            </h2>
            <p className={styles.sub}>
              <VariableProximity
                label="30 秒开始第一句。无需注册。"
                from={{ wght: 400, opsz: 14 }}
                to={{ wght: 900, opsz: 24 }}
                radius={70}
                falloff="linear"
                as="span"
              />
            </p>
          </div>

          <div className={styles.start}>
            <SpecularButton
              type="button"
              size="lg"
              onClick={onStart}
              /* 深空蓝底 + 琥珀 CTA 拉对比;琥珀在浅/深主题下都显眼。 */
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
        </div>
      </motion.div>
    </section>
  );
}