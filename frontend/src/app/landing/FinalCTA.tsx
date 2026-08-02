'use client';

/**
 * FinalCTA — 05 · 收尾 CTA
 *
 * 深色反色块(--ds-ink 底 + 白字主张),左上右下两个 mint glow blob
 * 缓慢漂移(20s 周期)。大字主张 + 大号主按钮 + 次级"了解词库"链接。
 * 整段 scroll-into-view 时 fadeUp;按钮 motion.button spring 上浮。
 */

import { useState, useEffect, type ReactElement } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import Button from '../ds/components/Button';
import { spring } from '../ds/motion';
import styles from './FinalCTA.module.css';

interface FinalCTAProps {
  onStart: () => void;
  onJumpToLibs?: () => void;
}

const SECTION_ID = 'final-cta';

export default function FinalCTA({ onStart, onJumpToLibs }: FinalCTAProps): ReactElement {
  const reduced = useReducedMotion();
  // blob 位置状态:启动时随机一点,之后用 CSS animation 漂移
  // 这里只是给一个 hover-scale 用,实际漂移走 CSS keyframes
  const [hovered, setHovered] = useState(false);

  // 启停 blob 漂移动画(reduced-motion 关闭)
  useEffect(() => {
    if (reduced) {
      document.documentElement.style.setProperty('--ds-blob-play', 'paused');
    } else {
      document.documentElement.style.setProperty('--ds-blob-play', 'running');
    }
  }, [reduced]);

  return (
    <section
      id={SECTION_ID}
      className={styles.root}
      aria-labelledby="final-cta-title"
    >
      <motion.div
        className={styles.block}
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={spring.soft}
      >
        {/* 装饰光晕 */}
        <span className={`${styles.blob} ${styles.blobTL}`} aria-hidden />
        <span className={`${styles.blob} ${styles.blobBR}`} aria-hidden />

        <div className={styles.inner}>
          <h2 id="final-cta-title" className={styles.title}>
            <span className={styles.titleLine}>练出英语肌肉记忆,</span>
            <span className={styles.titleLine}>从今天开始。</span>
          </h2>
          <p className={styles.kicker}>无需注册 · 30 秒开始第一句</p>

          <motion.div
            className={styles.actions}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={onStart}
              className={styles.start}
            >
              立即开始练习 →
            </Button>
            {onJumpToLibs ? (
              <button
                type="button"
                onClick={onJumpToLibs}
                className={styles.altLink}
              >
                或者,先了解词库
                <span className={styles.altArrow} aria-hidden>→</span>
              </button>
            ) : null}
          </motion.div>

          {/* 隐藏的语义说明,方便 screen reader 听到 hover 状态 */}
          <span className={styles.srOnly} aria-live="polite">
            {hovered ? '按钮可点击' : ''}
          </span>
        </div>
      </motion.div>
    </section>
  );
}
