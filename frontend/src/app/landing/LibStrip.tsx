'use client';

/**
 * LibStrip — 方案 C SECTION 3(2026-08 polish)
 *
 * 4 个真实词库 + Persistent Side Panel
 *
 *   - hover 左侧任意卡 → 右侧面板切换显示该 lib 信息
 *   - 点击左侧任意卡 → 直接进 /practice?lib=<id>(0 步额外点击)
 *   - 右侧面板自带"读这一句"按钮,二次入口
 *
 * 业界标准 polish:
 *   - 卡片改用语义结构:level(uppercase mono) + h3 name + meta + 按钮
 *   - SpecularButton intensity 调强,follow-mouse 跟随真正生效
 *   - 保留 CSS-only ::after mask 光标跟随描边辉光(CSS 层装饰,react-bits 不替代)
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { ScrollReveal, SpecularButton } from '@/components/effects';
import { staggerParent } from '../ds/motion';
import { VocabularyLib } from '../api';
import styles from './LibStrip.module.css';

interface LibStripProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

const SAMPLES: Record<string, { en: string; zh: string }> = {
  beginner: {
    en: 'I usually have coffee in the morning.',
    zh: '我通常早上喝咖啡。',
  },
  cet4: {
    en: 'The deadline for the assignment is next Monday.',
    zh: '作业的截止日期是下周一。',
  },
  cet6: {
    en: 'The research findings suggest a strong correlation.',
    zh: '研究结果表明有很强的相关性。',
  },
  ielts: {
    en: 'The data demonstrates a significant upward trend.',
    zh: '数据显示出明显的上升趋势。',
  },
};

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'A1 — A2 · 入门',
  cet4: 'B1 · 大学四级',
  cet6: 'B2 · 大学六级',
  ielts: 'C1 · 雅思',
};

const GENERIC_DESC = '从这里开始跟打 — 读完一句,写出来就是你的。';

const LIB_BUTTON_PALETTE: Record<
  string,
  { tint: string; base: string; line: string; text: string }
> = {
  beginner: { tint: '#8FCBF0', base: '#5BA8D8', line: '#FFFFFF', text: '#0C2C53' },
  cet4:     { tint: '#BA7517', base: '#854F0B', line: '#FFFFFF', text: '#FFFFFF' },
  cet6:     { tint: '#7B5BD0', base: '#4A2E8E', line: '#FFFFFF', text: '#FFFFFF' },
  ielts:    { tint: '#1F5A99', base: '#0C2C53', line: '#FFFFFF', text: '#FFFFFF' },
};
const DEFAULT_PALETTE = LIB_BUTTON_PALETTE.beginner;

export default function LibStrip({ libs, onPickLib }: LibStripProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (libs.length === 0) return null;

  const current = libs[currentIdx] ?? libs[0];
  const sample = SAMPLES[current.level] ?? {
    en: 'Reading makes a full person.',
    zh: '阅读使人完整。',
  };

  const onCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    e.currentTarget.style.setProperty('--glow-x', x.toFixed(1) + '%');
    e.currentTarget.style.setProperty('--glow-y', y.toFixed(1) + '%');
  };

  return (
    <section className={styles.root} aria-labelledby="lib-strip-title">
      <div className={styles.shell}>
        <ScrollReveal y={20} delay={0} className={styles.header}>
          <div className={styles.titleBlock}>
            <p className={styles.kicker}>SECTION 3 · 选词库</p>
            <h2 id="lib-strip-title" className={styles.title}>
              入门到雅思 · 选哪一份?
            </h2>
          </div>
          <span className={styles.totalCount}>
            {libs.length} 份词库 ·{' '}
            {libs.reduce((acc, l) => acc + l.word_count, 0).toLocaleString()} 词 ·{' '}
            A1 到 C1
          </span>
        </ScrollReveal>

        <div className={styles.layout}>
          <motion.div
            className={styles.list}
            variants={staggerParent}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '0px 0px -80px 0px' }}
          >
            {libs.map((lib, idx) => {
              const isActive = idx === currentIdx;
              const isHover = idx === hoveredIdx;
              const palette = LIB_BUTTON_PALETTE[lib.level] ?? DEFAULT_PALETTE;
              return (
                <motion.div
                  key={lib.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '0px 0px -80px 0px' }}
                  transition={{
                    duration: 0.4,
                    ease: [0.16, 1, 0.3, 1],
                    delay: 0.05 * idx,
                  }}
                  onMouseEnter={() => {
                    setHoveredIdx(idx);
                    setCurrentIdx(idx);
                  }}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onMouseMove={onCardMouseMove}
                  className={`${styles.libCardWrap} ${isActive ? styles.libCardActive : ''} ${isHover ? styles.libCardHover : ''}`}
                >
                  <SpecularButton
                    size="lg"
                    onClick={() => onPickLib(lib.id)}
                    tint={palette.tint}
                    tintOpacity={1}
                    baseColor={palette.base}
                    lineColor={palette.line}
                    textColor={palette.text}
                    blur={6}
                    intensity={1.2}
                    followMouse
                    proximity={300}
                    className={styles.libCardBtn}
                    aria-label={`开始 ${lib.name}`}
                  >
                    <span className={styles.libLevel}>{lib.level}</span>
                    <span className={styles.libName}>{lib.name}</span>
                    <span className={styles.libCount}>
                      {lib.word_count.toLocaleString()} 词 · {lib.sentence_count} 句
                    </span>
                    <span className={styles.libCta}>点击开始 →</span>
                  </SpecularButton>
                </motion.div>
              );
            })}
          </motion.div>

          <aside className={styles.panel} aria-live="polite">
            <div className={styles.panelTop}>
              <span className={styles.panelKicker}>
                {hoveredIdx === null ? '默认查看' : '当前查看'}
              </span>
              <span className={styles.panelLevel}>
                {LEVEL_LABEL[current.level] ?? current.level}
              </span>
            </div>

            <div className={styles.panelImageSlot} aria-label="词库封面占位">
              <span className={styles.panelImageHint}>封面图片占位</span>
            </div>

            <h3 className={styles.panelName}>{current.name}</h3>

            <div className={styles.panelMeta}>
              <span>{current.word_count.toLocaleString()} 词</span>
              <span className={styles.panelDot} />
              <span>{current.sentence_count} 句</span>
              <span className={styles.panelDot} />
              <span>{LEVEL_LABEL[current.level] ?? current.level}</span>
            </div>

            <p className={styles.panelDesc}>
              {current.description ?? GENERIC_DESC}
            </p>

            <div className={styles.panelSample}>
              <span className={styles.panelSampleLabel}>示例句</span>
              <span className={styles.panelSampleEn}>{sample.en}</span>
              <span className={styles.panelSampleZh}>{sample.zh}</span>
            </div>

            <div className={styles.panelCtaRow}>
              <SpecularButton
                size="md"
                onClick={() => onPickLib(current.id)}
                tint="#8FCBF0"
                tintOpacity={1}
                baseColor="#5BA8D8"
                lineColor="#FFFFFF"
                textColor="#0C2C53"
                blur={8}
                intensity={1.2}
                followMouse
                proximity={400}
                className={styles.panelCta}
              >
                读这一句 →
              </SpecularButton>
              <span className={styles.panelHint}>
                {hoveredIdx === null
                  ? 'hover 或点击\n左侧切换'
                  : '点击进入跟打'}
              </span>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}