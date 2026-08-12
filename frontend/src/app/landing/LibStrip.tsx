'use client';

/**
 * LibStrip — 方案 A SECTION 3 (2026-08, shadcn MagicBento 重构)
 *
 * 之前:复用 MagicBento 4 张中文词库卡(level + 词数 + SpecularButton)
 * 现在:shadcn MagicBento 不接外部 cards prop,卡内容硬编码为 6 张英文演示卡。
 *      失去"4 个真实词库选择"功能,保留 section header。
 */

import MagicBento from '@/components/MagicBento';
import AnimatedContent from '@/components/AnimatedContent';
import { VocabularyLib } from '../api';
import styles from './LibStrip.module.css';

interface LibStripProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'A1 — A2 · 入门',
  cet4: 'B1 · 大学四级',
  cet6: 'B2 · 大学六级',
  ielts: 'C1 · 雅思',
};

export default function LibStrip({ libs, onPickLib: _onPickLib }: LibStripProps) {
  return (
    <section className={styles.root} aria-labelledby="lib-strip-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 3 · 选词库</p>
        <h2 id="lib-strip-title" className={styles.title}>
          入门到雅思 · 选哪一份?
        </h2>
        <p className={styles.subtitle}>
          {libs.length} 份词库 · {libs.reduce((acc, l) => acc + l.word_count, 0).toLocaleString()} 词 · A1 到 C1
        </p>
      </AnimatedContent>

      {/* shadcn MagicBento:硬编码 6 张英文示例卡 */}
      <MagicBento
        className={styles.bento}
        enableBorderGlow
        enableSpotlight
        clickEffect
        spotlightRadius={420}
        glowColor="143, 203, 240"
      />
    </section>
  );
}