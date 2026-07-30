'use client';

import styles from './PracticeHintCard.module.css';

/**
 * PracticeHintCard — guest 练习页触发卡片
 *
 * 用于「进步时刻」轻量引导登录，不阻挡答题区、不抢焦点。
 * 由 TranslationSession 内部触发条件渲染，本组件不维护任何状态。
 *
 * 两种触发文案：
 *   - kind='improved'  → "比上一句更好 · 登录后保留这份进度"
 *   - kind='rate'      → "正确率达到 80% · 登录后保留这份进度"
 *
 * 交互：
 *   - "登录" 链接 → 父组件 onLogin（跳 /login?from=<encoded URL>）
 *   - "×" 按钮    → 父组件 onDismiss（本次会话内不再出现）
 *
 * A11y：
 *   - role="status" + aria-live="polite"
 *   - 不自动 focus，避免抢答题区焦点
 */

export type PracticeHintCardKind = 'improved' | 'rate';

interface PracticeHintCardProps {
  kind: PracticeHintCardKind;
  onLogin: () => void;
  onDismiss: () => void;
}

const COPY: Record<PracticeHintCardKind, string> = {
  improved: '比上一句更好 · 登录后保留这份进度',
  rate: '正确率达到 80% · 登录后保留这份进度',
};

export default function PracticeHintCard({
  kind,
  onLogin,
  onDismiss,
}: PracticeHintCardProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <span className={styles.text}>{COPY[kind]}</span>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.login}
          onClick={onLogin}
          aria-label="登录以保留进度"
        >
          登录
        </button>
        <button
          type="button"
          className={styles.close}
          onClick={onDismiss}
          aria-label="关闭提示"
        >
          ×
        </button>
      </div>
    </div>
  );
}