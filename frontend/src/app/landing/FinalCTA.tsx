'use client';

/**
 * FinalCTA — 方案 B 黑色 CTA bar(2026-08 polish)
 *
 * 与方案 B 草图一致:深色反色块 + 横向 layout。
 * 左侧大标题"读完一句,就是你的"(ShinyText 强化决心感)+ ShinyText kicker
 * "最后一步",右侧琥珀色 SpecularButton。
 * 背景走 React Bits <Threads> WebGL 流线,与登录/注册同一套视觉语言。
 *
 * 业界标准 polish:
 *   - 标题用 ShinyText(品牌统一 + 决心感)
 *   - 加 Badge "最后一步" 作 kicker,作为整页的"决策锚点"
 *   - 整块用 ScrollReveal 而非 motion 散件
 */

import { type ReactElement } from 'react';
import { ScrollReveal, ShinyText, SpecularButton, Threads, VariableProximity } from '@/components/effects';
import { Badge } from '@/components/ui/badge';
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
      <ScrollReveal y={20} delay={0} className={styles.bar}>
        <Threads
          className={styles.threadsBg}
          color={threadsColor}
          amplitude={0.8}
          distance={0.25}
          enableMouseInteraction={true}
        />

        <div className={styles.content}>
          <div className={styles.titleBlock}>
            <Badge variant="amber" className={styles.kickerBadge}>最后一步</Badge>
            <h2 id="final-cta-title" className={styles.title}>
              <ShinyText
                as="span"
                text="读完一句,就是你的"
                className={styles.titleMain}
                speed={3}
                color="var(--ds-tint-strong)"
                shineColor="var(--ds-cta)"
              />
              <span className={styles.titleArrow} aria-hidden="true">→</span>
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
      </ScrollReveal>
    </section>
  );
}