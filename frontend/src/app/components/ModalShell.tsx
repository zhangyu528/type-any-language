'use client';

/**
 * ModalShell — 通用模态外壳。
 *
 * 复刻 (auth)/_components/AuthModal.tsx 已验证的那套配方：
 *   - createPortal 到 document.body(防 z-index / overflow 冲突)
 *   - 遮罩点击关闭 + Esc 关闭 + 右上角 ✕ 关闭
 *   - body scroll lock
 *   - 最小 focus trap(Tab 从末尾回首、Shift+Tab 从首回末)
 *   - aria-modal + aria-labelledby 指向标题
 *
 * 简化说明(与 AuthModal 一致,写给后任):
 *   - 不处理:外部 programmatic focus / screen-reader virtual cursor /
 *     IME composition
 *   - 覆盖路径:Esc + 遮罩点击 + ✕ + Tab/Shift+Tab 边界循环
 *   - 内容若变复杂,改用 useEffect 重新收集 focusable 集合
 *
 * 为什么不直接改 AuthModal 复用这个:AuthModal 是能跑的登录路径,
 * 本次改动不碰它。等下一次动 auth UI 时再把它收敛到这里。
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './ModalShell.module.css';

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  /** 对话框标题 — 同时用作 aria-labelledby 的目标。 */
  title: string;
  /** 标题下的一行说明(可选)。 */
  subtitle?: string;
  /** 内容区最大宽度,默认 640px。 */
  maxWidth?: number;
  children: ReactNode;
}

export default function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  maxWidth,
  children,
}: ModalShellProps) {
  // SSR 安全 — render 期间不碰 document。portal 只在客户端挂载。
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <ModalShellBody
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      maxWidth={maxWidth}
    >
      {children}
    </ModalShellBody>,
    document.body
  );
}

function ModalShellBody({
  onClose,
  title,
  subtitle,
  maxWidth,
  children,
}: Omit<ModalShellProps, 'open'>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Esc 关闭 — 只在打开期间监听(body 随 open 挂载/卸载)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // body scroll lock。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 打开时把焦点移进对话框,否则焦点还留在触发按钮上 —— 键盘用户
  // 按 Tab 会先走完页面剩余部分才进到 modal 里。
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
  }, []);

  // 最小 focus trap:末尾 Tab → 首个;首个 Shift+Tab → 末尾。
  // 中间元素交给浏览器默认行为。局限见文件头注释。
  const onDialogKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    []
  );

  // 对话框内点击不应冒泡到遮罩(否则点内容就关了)。
  const onDialogClick = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose} tabIndex={-1}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        style={maxWidth ? { maxWidth: `${maxWidth}px` } : undefined}
        onClick={onDialogClick}
        onKeyDown={onDialogKeyDown}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
