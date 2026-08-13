'use client';

/**
 * LibStrip — SECTION 3 选词库(2026-08 polish)
 *
 * 真实 VocabularyLib[] 卡片网格。每张卡 = 等级 chip + 词库名
 * (DecryptedText 字符还原,呼应"读出来"母题) + 词/句数 + 描述 +
 * SpecularButton「开始读」直接 onPickLib 进入练习。
 *
 * 2026-08 polish:
 *   - 4 张卡都包 BorderGlow,跟 Section 1/2 hover 体验一致
 *   - 第一张卡视觉差异化(粉色边框 + 推荐小标 + translateY -2px)
 *   - header 居中,跟全站统一
 *
 * reactbits 角色:
 *   - BorderGlow      → 4 张卡 hover 光标微光
 *   - DecryptedText   → 词库名(animateOn="view" 滚动入视触发还原)
 *   - SpecularButton  → 单金属「开始读」CTA
 *   - AnimatedContent → 错峰入场
 */

import { useReducedMotion } from 'motion/react';
import DecryptedText from '@/components/DecryptedText';
import SpecularButton from '@/components/SpecularButton';
import BorderGlow from '@/components/BorderGlow';
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
        <p className={styles.kicker}>SECTION 2 · 选词库</p>
        <h2 id="lib-strip-title" className={styles.title}>
          入门到雅思 · 选哪一份?
        </h2>
        <p className={styles.subtitle}>
          {libs.length} 份词库 · {libs.reduce((acc, l) => acc + l.word_count, 0).toLocaleString()} 词 · A1 到 C1
        </p>
      </AnimatedContent>

      <div className={styles.grid}>
        {libs.map((lib, i) => {
          const isFeatured = i === 0;
          return (
            <AnimatedContent
              key={lib.id}
              distance={20}
              delay={(80 + i * 80) / 1000}
              direction="vertical"
              className={styles.libCardWrap}
            >
              <BorderGlow
                /* glowRadius 32→16:canvas halo 缩半,即使 wrapper overflow: hidden
                   失效,halo 也不会大幅外溢 */
                glowRadius={16}
                glowColor="143 203 240"
                glowIntensity={0.85}
                colors={['var(--ds-action-tint)', '#5BA8D8', '#2F80C0']}
                backgroundColor="transparent"
                borderRadius={20}
                fillOpacity={0.2}
                className={styles.cardGlowWrap}
              >
                <div className={`${styles.libCard} ${isFeatured ? styles.libCardFeatured : ''}`}>
                  <div className={styles.cardInner}>
                    {isFeatured && <span className={styles.featuredBadge}>推荐</span>}
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
                        <SpecularButton
                      size="sm"
                      onClick={() => onPickLib(lib.id)}
                  /* CTA:featured 紫(--ds-convert),非 featured 冷蓝(--ds-action-tint) */
                      tint={isFeatured ? 'var(--ds-convert)' : 'var(--ds-action-tint)'}
                      tintOpacity={0.95}
                      baseColor={isFeatured ? '#7C3AED' : '#5BA8D8'}
                      lineColor="#FFFFFF"
                      textColor={isFeatured ? '#FFFFFF' : '#0C2C53'}
                      blur={isFeatured ? 6 : 4}
                      followMouse
                      proximity={220}
                      className={styles.libBtn}
                    >
                      开始读 →
                    </SpecularButton>
                  </div>
                </div>
              </BorderGlow>
            </AnimatedContent>
          );
        })}
      </div>
    </section>
  );
}