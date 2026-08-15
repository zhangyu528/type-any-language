'use client';

/**
 * FirstRunGuide — 首跑 / 空状态引导态（方向 B 新模块，2026-08-15 打磨）。
 *
 * 当无任何练习记录（session_id 为 null 且本周 0 句）时，概览整页切换为
 * 此引导态。打磨后定位为「欢迎 hero」：
 *   - 顶部 sparkle 徽章 + 紫色光晕，营造"开始"仪式感；
 *   - 三步法（选词库 → 听音敲写 → 看反馈）用带箭头的图标步骤条串联；
 *   - 唯一主 CTA = 推荐词库（最近词库优先，否则 catalog 首张/推荐卡），
 *     直驱练习，避免「pick 按钮 vs 直接开练 chips」的歧义；
 *   - 其余词库作为备选 chips，带等级 + 词数，方便首次做选择；
 *   - "浏览全部词库" 走 onPickLib() 打开选择器；
 *   - 底部一句"下一步"提示，预告设定每日目标，强化「这是第一步」。
 *
 * 纯展示组件，无 hooks（保持 hook 顺序稳定）。复用 onStartLib / onPickLib
 * 两个既有入口，不新增路由逻辑。
 */

import { Fragment } from 'react';
import { Catalog, VocabularyLib } from '../../api';
import styles from './FirstRunGuide.module.css';

interface FirstRunGuideProps {
  catalog?: Catalog | null;
  recentLibId?: string | null;
  recentLibName?: string | null;
  onStartLib: (libId: string) => void;
  onPickLib: () => void;
}

const BookIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2z" />
    <path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z" />
  </svg>
);

const HearIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12h2l2-5 3 10 3-14 2 9h4" />
  </svg>
);

const CheckIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);

const STEPS = [
  { n: 1, label: '选词库', hint: '挑一份适合你的', icon: BookIcon },
  { n: 2, label: '听音敲写', hint: '逐字打出听到的', icon: HearIcon },
  { n: 3, label: '看反馈', hint: '即时纠错巩固', icon: CheckIcon },
];

export default function FirstRunGuide({
  catalog,
  recentLibId,
  recentLibName,
  onStartLib,
  onPickLib,
}: FirstRunGuideProps) {
  const libs = catalog?.libs ?? [];
  const recentFromCatalog = recentLibId ? libs.find((l) => l.id === recentLibId) ?? null : null;
  const recommended: VocabularyLib | null =
    recentFromCatalog ??
    libs[0] ??
    (recentLibName ? { id: recentLibId ?? '', name: recentLibName, level: '', word_count: 0, sentence_count: 0 } : null);
  const altLibs = libs.filter((l) => recommended && l.id !== recommended.id).slice(0, 3);

  return (
    <section className={styles.root} aria-label="开始练习">
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.badge} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
          <path d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16l-1.8-5L5 9.2l5.2-1.8z" />
          <path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9z" opacity="0.7" />
        </svg>
      </div>

      <p className={styles.kicker}>第一步 · 开始学习</p>
      <h2 className={styles.title}>开始你的第一句</h2>
      <p className={styles.sub}>
        听音 → 逐字敲写 → 即时反馈。三步循环，不知不觉把一个词刻进肌肉记忆。
      </p>

      <ol className={styles.steps}>
        {STEPS.map((s, i) => (
          <Fragment key={s.n}>
            <li className={styles.step}>
              <span className={styles.stepIcon}>{s.icon}</span>
              <span className={styles.stepLabel}>{s.label}</span>
              <span className={styles.stepHint}>{s.hint}</span>
            </li>
            {i < STEPS.length - 1 ? (
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            ) : null}
          </Fragment>
        ))}
      </ol>

      {recommended ? (
        <button type="button" className={styles.primary} onClick={() => onStartLib(recommended.id)}>
          {recentFromCatalog ? `继续《${recommended.name}》→` : `开始《${recommended.name}》第一句 →`}
        </button>
      ) : (
        <button type="button" className={styles.primary} onClick={onPickLib}>
          挑一个词库开始 →
        </button>
      )}

      {altLibs.length > 0 ? (
        <div className={styles.altWrap}>
          <span className={styles.altLabel}>或者，直接选一份开始</span>
          <div className={styles.chips}>
            {altLibs.map((lib) => (
              <button key={lib.id} type="button" className={styles.chip} onClick={() => onStartLib(lib.id)}>
                {lib.level ? <span className={styles.chipLevel}>{lib.level}</span> : null}
                <span className={styles.chipName}>{lib.name}</span>
                <span className={styles.chipMeta}>{lib.word_count.toLocaleString()} 词</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button type="button" className={styles.browse} onClick={onPickLib}>
        浏览全部词库
      </button>

      <p className={styles.note}>完成第一句后，主页会帮你设定每日目标，并追踪学习进度。</p>
    </section>
  );
}
