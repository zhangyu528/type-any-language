'use client';

/**
 * LibPicker — 选词库的内容区,渲染在 ModalShell 内部。
 *
 * 触发源(均在 /dashboard 内,不换路由):
 *   - ContinueCard "Start your first lesson"(无 lib_id 时)
 *   - ContinueCard 已有 session 但 lib 已失效
 *   - DailyGoal "Practice now"(无 prefs.libId 时)
 *
 * 形态说明:标题 / 副标题 / 关闭按钮由 ModalShell 提供 —— 这里只
 * 负责列表本身。早期版本是内联 section 自带大标题 + "← 返回",
 * 那让它看起来像跳了一个新页面(实际没有),所以收进 modal。
 *
 * 动画:打开 modal 时词库卡片用 motion 的 stagger 级联入场 ——
 * "继续上次"先现身,然后其余卡片按 staggerChildren 间隔依次
 * 上浮+淡入。整段动画一次性触发,不再循环(repeat: 1)。
 *
 * 数据流:
 *   - libs 由 dashboard/page.tsx 通过 getContentCatalog 拉取
 *   - recentLibId 来自 prefs.libId localStorage(landing/data.ts::readRecentLibId)
 *   - onPick(libId) 上抛,父组件写 URL(?lib=X)并进入练习
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  VocabularyLib,
  loadTranslationProgress,
  libProgressPct,
  ANONYMOUS_USER_ID,
} from '../api';
import { readRecentLibId } from '../landing/data';
import { useAuth } from '../lib/auth';
import { useTheme } from '../components/ThemeProvider';
import { riseIn, staggerParent } from '../ds/motion';
import styles from './LibPicker.module.css';

/**
 * Course-type → display label + accent color.
 * 2026-08:状态色按主题走(跟 landing FinalCTA / LibStrip featured
 * 主转化母题对齐 — light=冷紫 / dark=暖琥珀):
 *   listening  听力  light=#8B5CF6 冷紫  /  dark=#EFA535 暖琥珀
 *   cet6       等级  light=#8B5CF6 冷紫  /  dark=#EFA535 暖琥珀
 *   amber 通用 通用  light=#8B5CF6 冷紫  /  dark=#EFA535 暖琥珀
 * 蓝/绿两主题同色(#378ADD/#1D9E75)已经合理不需要切。
 */
export const COURSE_TYPE_META: Record<'light' | 'dark', Record<string, { label: string; color: string }>> = {
  light: {
    vocab:     { label: '词汇', color: '#378ADD' },
    grammar:   { label: '语法', color: '#1D9E75' },
    listening: { label: '听力', color: '#8B5CF6' },
    exam:      { label: '考试', color: '#7F77DD' },
  },
  dark: {
    vocab:     { label: '词汇', color: '#378ADD' },
    grammar:   { label: '语法', color: '#1D9E75' },
    listening: { label: '听力', color: '#EFA535' },
    exam:      { label: '考试', color: '#A78BFA' },
  },
};

const ACCENT_COLORS: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    blue:   '#378ADD',
    green:  '#1D9E75',
    amber:  '#8B5CF6',  // 紫代替琥珀
    purple: '#7F77DD',
  },
  dark: {
    blue:   '#378ADD',
    green:  '#1D9E75',
    amber:  '#EFA535',
    purple: '#A78BFA',
  },
};

const LEVEL_ACCENT: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    beginner: '#378ADD',
    cet4:     '#1D9E75',
    cet6:     '#8B5CF6',
    ielts:    '#7F77DD',
  },
  dark: {
    beginner: '#378ADD',
    cet4:     '#1D9E75',
    cet6:     '#EFA535',
    ielts:    '#7F77DD',
  },
};
const FALLBACK_PALETTE: Record<'light' | 'dark', string[]> = {
  light: ['#378ADD', '#1D9E75', '#8B5CF6', '#7F77DD'],
  dark:  ['#378ADD', '#1D9E75', '#EFA535', '#7F77DD'],
};

// 2026-08:状态色按主题走,函数接受 theme 参数(显式,不依赖 hook 内部态,保持可单元测试)。
export function courseAccentColor(lib: VocabularyLib, theme: 'light' | 'dark'): string {
  const accents = ACCENT_COLORS[theme];
  if (lib.accent && accents[lib.accent]) return accents[lib.accent];
  const lvl = (lib.level ?? '').toLowerCase();
  const levelMap = LEVEL_ACCENT[theme];
  if (levelMap[lvl]) return levelMap[lvl];
  let h = 0;
  for (let i = 0; i < lib.id.length; i++) h = (h * 31 + lib.id.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[theme][h % FALLBACK_PALETTE[theme].length];
}

export function courseTypeLabel(lib: VocabularyLib, theme: 'light' | 'dark'): string {
  const t = lib.course_type ?? 'vocab';
  const meta = COURSE_TYPE_META[theme][t] ?? COURSE_TYPE_META[theme].vocab;
  return `${meta.label} · ${lib.level.toUpperCase()}`;
}

function courseStatLine(lib: VocabularyLib): string {
  const parts: string[] = [];
  if (lib.lesson_count) parts.push(`约 ${lib.lesson_count} 课`);
  if (lib.est_minutes) parts.push(`约 ${lib.est_minutes} 分钟`);
  if (parts.length === 0) parts.push(`${lib.word_count.toLocaleString()} 词`);
  return parts.join(' · ');
}

export interface LibPickerProps {
  libs: VocabularyLib[];
  onPick: (libId: string) => void;
}

export default function LibPicker({ libs, onPick }: LibPickerProps) {
  const recentLibId = useMemo(() => readRecentLibId(), []);
  const { theme } = useTheme();
  const recentLib = recentLibId
    ? libs.find((l) => l.id === recentLibId) ?? null
    : null;
  const otherLibs = recentLib
    ? libs.filter((l) => l.id !== recentLib.id)
    : libs;

  const { user } = useAuth();
  const userId = user?.id ?? ANONYMOUS_USER_ID;
  const progress = useMemo(() => loadTranslationProgress(userId), [userId]);

  return (
    <div className={styles.root}>
      {recentLib ? (
        <motion.div
          className={styles.sectionWrap}
          variants={riseIn}
          initial="hidden"
          animate="show"
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className={styles.sectionLabel}>继续上次</p>
          <LibCard
            lib={recentLib}
            onClick={() => onPick(recentLib.id)}
            recent
            progressPct={libProgressPct(recentLib, progress)}
            theme={theme}
          />
        </motion.div>
      ) : null}

      <motion.div
        className={styles.sectionWrap}
        variants={staggerParent}
        initial="hidden"
        animate="show"
      >
        <motion.p className={styles.sectionLabel} variants={riseIn}>
          {recentLib ? '所有词库' : '可用词库'}
        </motion.p>
        {otherLibs.length === 0 ? (
          <motion.p className={styles.empty} variants={riseIn}>
            暂无可用词库。
          </motion.p>
        ) : (
          <motion.ul className={styles.grid} variants={staggerParent}>
            {otherLibs.map((lib) => (
              <motion.li key={lib.id} variants={riseIn}>
                <LibCard
                  lib={lib}
                  onClick={() => onPick(lib.id)}
                  progressPct={libProgressPct(lib, progress)}
                  theme={theme}
                />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </motion.div>
    </div>
  );
}

export function LibCard({
  lib,
  onClick,
  recent = false,
  progressPct,
  ctaLabel,
  theme,
  /** 在「课程库」视图里标记该课已加入我的课程（仅展示，不可再点添加）。 */
  enrolled = false,
  /** 是否展示进度条。发现页「课程库」里未加入的课程进度几乎都是 0%，
   *  展示空进度条是噪声，故由调用方在浏览态隐藏；我的课程/已加入/选词弹窗仍显示。 */
  showProgress = true,
}: {
  lib: VocabularyLib;
  onClick: () => void;
  recent?: boolean;
  progressPct?: number | null;
  /** Override the status-derived CTA text (e.g. "添加" in 发现 view). */
  ctaLabel?: string;
  /** 2026-08:状态色按主题走,父组件传 light/dark 进来(LibCard 是 inner
   *  component,不直接 useTheme 避免不必要的 hook 链路,保持纯渲染)。 */
  theme: 'light' | 'dark';
  /** 在「课程库」视图里标记该课已加入我的课程（仅展示，不可再点添加）。 */
  enrolled?: boolean;
  /** 是否展示进度条（默认 true；发现页浏览态可由调用方关闭）。 */
  showProgress?: boolean;
}) {
  const color = courseAccentColor(lib, theme);
  const typeLabel = courseTypeLabel(lib, theme);
  const pct = progressPct ?? 0;
  const cta = ctaLabel ?? (pct >= 100 ? '复习' : pct > 0 ? '继续' : '开始');
  const progressLabel =
    pct >= 100 ? '已完成' : pct > 0 ? `进行中 ${pct}%` : '未开始';
  return (
    <button
      type="button"
      className={`${styles.card} ${recent ? styles.cardRecent : ''}`}
      onClick={onClick}
    >
      <span className={styles.accentBar} style={{ background: color }} aria-hidden />
      <span className={styles.typeRow}>
        <span className={styles.typeChip} style={{ color }}>
          {typeLabel}
        </span>
        {enrolled ? (
          <span className={styles.addedBadge} aria-hidden>
            ✓ 已添加
          </span>
        ) : null}
      </span>
      <h3 className={styles.libName}>{lib.name}</h3>
      <p className={styles.libStat}>{courseStatLine(lib)}</p>
      <p className={styles.libDesc}>
        {lib.description ?? '从这一份开始,逐字练。'}
      </p>
      {showProgress ? (
        <div className={styles.progress}>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${lib.name} 进度 ${pct}%`}
          >
            <span
              className={styles.fill}
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
          <span className={styles.progressLabel}>{progressLabel}</span>
        </div>
      ) : null}
      <span className={styles.cta}>
        <span className={styles.ctaLabel}>{cta}</span>
        <span className={styles.ctaArrow} aria-hidden>→</span>
      </span>
    </button>
  );
}
