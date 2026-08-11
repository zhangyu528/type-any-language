'use client';

/**
 * LibStrip — 方案 C SECTION 3 (修订:Persistent Side Panel)
 *
 * 4 个真实词库 (+ 未来 N 个)
 * **核心模式**:左侧 2x2 lib 卡网格(每张都是 CTA,点哪张进哪个 /practice)+
 * 右侧永远显示"当前查看"lib 的详细面板(封面/词句数/描述/示例句/CTA)。
 *
 *   - hover 左侧任意卡 → 右侧面板切换显示该 lib 信息
 *   - 点击左侧任意卡 → 直接进 /practice?lib=<id>(0 步额外点击)
 *   - 右侧面板自带"读这一句"按钮,二次入口
 *
 * 之前的实现:每张卡 = `<motion.button>`(原生 button),鼠标 hover 联动右侧。
 * 现在所有控件都用 react-bits:4 张卡 = `<SpecularButton size="lg">`,右面板 CTA
 * 也是 `<SpecularButton size="md">`。原来用 CSS custom property `--glow-x/--glow-y`
 * 做光标跟随描边辉光 — 这部分保留在 CSS 里(`libCardHover` className + module.css),
 * react-bits 不替代 CSS-only 的纯视觉装饰。
 *
 * 硬编码示例句(SAMPLES)按 lib.level 取一个,未来后端 catalog 接口扩展
 * `sample_sentence` / `sample_translation` 字段后可改为 lib.sample_sentence。
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { SpecularButton } from '@/components/effects';
import { riseIn, staggerParent } from '../ds/motion';
import { VocabularyLib } from '../api';
import styles from './LibStrip.module.css';

interface LibStripProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

// 按 lib.level 取示例句 + 中文翻译。兜底用 lib.description 作为右侧 desc,
// 描述为空时给一个 level 级的通用文案。
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

// SpecularButton 视觉配色:每个 level 一种 tint/base 组合,跟 lib 词库品牌色一致。
// 之前是 CSS module 写死,现在提到组件里集中维护。
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
  // 当前查看的 lib 索引(默认 0 = 第一个 lib)。hover / 点击左侧卡会更新。
  const [currentIdx, setCurrentIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (libs.length === 0) return null;

  const current = libs[currentIdx] ?? libs[0];
  const sample = SAMPLES[current.level] ?? {
    en: 'Reading makes a full person.',
    zh: '阅读使人完整。',
  };

  // 跟随光标的 MagicBento 风格边框辉光 — 写到每个 SpecularButton 的 wrapper 上
  // (SpecularButton 内部有自己的 hover 行为;CSS 自定义属性驱动的是外层装饰描边)。
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
        <motion.header
          className={styles.header}
          variants={staggerParent}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '0px 0px -80px 0px' }}
        >
          <div className={styles.titleBlock}>
            <motion.p className={styles.kicker} variants={riseIn}>
              SECTION 3 · 选词库
            </motion.p>
            <motion.h2
              id="lib-strip-title"
              className={styles.title}
              variants={riseIn}
            >
              入门到雅思 · 选哪一份?
            </motion.h2>
          </div>
          <motion.span className={styles.totalCount} variants={riseIn}>
            {libs.length} 份词库 ·{' '}
            {libs.reduce((acc, l) => acc + l.word_count, 0).toLocaleString()} 词 ·{' '}
            A1 到 C1
          </motion.span>
        </motion.header>

        <div className={styles.layout}>
          {/* ===== 左侧:2x2 lib 卡 grid,每张都是 CTA ===== */}
          <div className={styles.list}>
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
          </div>

          {/* ===== 右侧:永远显示的详情面板 ===== */}
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