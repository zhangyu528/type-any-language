'use client';

/**
 * LibStrip — 重设计 SECTION 3
 *
 * 之前:MagicBento 硬编码 6 张英文演示卡,完全忽略真实 `libs` prop(功能 bug,
 *   用户点"开始读"没有任何真实词库可进)。
 * 现在:渲染真实的 VocabularyLib[] —— 每张卡 = 等级 chip + 词库名
 *   (DecryptedText 字符还原,呼应"读出来"签名母题) + 词/句数 + 描述 +
 *   单金属 SpecularButton「开始读」直接 onPickLib 进入练习。
 *
 * reactbits 角色:
 *   - DecryptedText → 词库名(animateOn="view" 滚动入视触发还原)
 *   - SpecularButton → 单金属「开始读」CTA
 *   - AnimatedContent → 错峰入场(沿用全站节奏)
 */

import { useReducedMotion } from 'motion/react';
import DecryptedText from '@/components/DecryptedText';
import SpecularButton from '@/components/SpecularButton';
import AnimatedContent from '@/components/AnimatedContent';
import { VocabularyLib } from '../api';
import styles from './LibStrip.module.css';

interface LibStripProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

export default function LibStrip({ libs, onPickLib }: LibStripProps) {
  const reduce = useReducedMotion();

  return (
    <section id="lib-strip" className={styles.root} aria-labelledby="lib-strip-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 3 · 选词库</p>
        <h2 id="lib-strip-title" className={styles.title}>
          入门到雅思 · 选哪一份?
        </h2>
        <p className={styles.subtitle}>
          {libs.length} 份词库 · {libs.reduce((acc, l) => acc + l.word_count, 0).toLocaleString()} 词 · A1 到 C1
        </p>
      </AnimatedContent>

      <div className={styles.grid}>
        {libs.map((lib, i) => (
          <AnimatedContent
            key={lib.id}
            distance={20}
            delay={(80 + i * 80) / 1000}
            direction="vertical"
            className={styles.libCard}
          >
            <div className={styles.cardInner}>
              <span className={styles.libLevel}>{lib.level}</span>
              <h3 className={styles.libName}>
                {reduce ? (
                  lib.name
                ) : (
                  <DecryptedText
                    text={lib.name}
                    animateOn="view"
                    sequential
                    revealDirection="start"
                    speed={35}
                    maxIterations={6}
                  />
                )}
              </h3>
              <p className={styles.libMeta}>
                {lib.word_count.toLocaleString()} 词 · {lib.sentence_count.toLocaleString()} 句
              </p>
              {lib.description ? <p className={styles.libLevelLabel}>{lib.description}</p> : null}
              <div className={styles.cardSpacer} />
              <SpecularButton
                size="sm"
                onClick={() => onPickLib(lib.id)}
                tint="#8FCBF0"
                tintOpacity={0.9}
                baseColor="#5BA8D8"
                lineColor="#FFFFFF"
                textColor="#0C2C53"
                blur={4}
                followMouse
                proximity={220}
                className={styles.libBtn}
              >
                开始读 →
              </SpecularButton>
            </div>
          </AnimatedContent>
        ))}
      </div>
    </section>
  );
}
