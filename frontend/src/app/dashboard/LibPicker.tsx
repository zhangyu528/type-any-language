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
import { VocabularyLib } from '../api';
import { readRecentLibId } from '../landing/data';
import { riseIn, staggerParent } from '../ds/motion';
import styles from './LibPicker.module.css';

export interface LibPickerProps {
  libs: VocabularyLib[];
  onPick: (libId: string) => void;
}

export default function LibPicker({ libs, onPick }: LibPickerProps) {
  const recentLibId = useMemo(() => readRecentLibId(), []);
  const recentLib = recentLibId
    ? libs.find((l) => l.id === recentLibId) ?? null
    : null;
  const otherLibs = recentLib
    ? libs.filter((l) => l.id !== recentLib.id)
    : libs;

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
          <LibCard lib={recentLib} onClick={() => onPick(recentLib.id)} recent />
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
                <LibCard lib={lib} onClick={() => onPick(lib.id)} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </motion.div>
    </div>
  );
}

function LibCard({
  lib,
  onClick,
  recent = false,
}: {
  lib: VocabularyLib;
  onClick: () => void;
  recent?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.card} ${recent ? styles.cardRecent : ''}`}
      onClick={onClick}
    >
      <span className={styles.badge} aria-hidden>
        {lib.level.toUpperCase()}
      </span>
      <h3 className={styles.libName}>{lib.name}</h3>
      <p className={styles.libMeta}>
        <span className={styles.metaNum} aria-hidden>
          {lib.word_count.toLocaleString()}
        </span>{' '}
        词
      </p>
      <p className={styles.libDesc}>
        {lib.description ?? '从这一份开始,逐字练。'}
      </p>
      <span className={styles.cta}>
        <span className={styles.ctaLabel}>开始这个词库</span>
        <span className={styles.ctaArrow} aria-hidden>→</span>
      </span>
    </button>
  );
}
