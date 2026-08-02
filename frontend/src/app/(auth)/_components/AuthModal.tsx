'use client';

/**
 * AuthModal — 居中弹出的 auth 对话框,挂在 (auth)/ 路径之外也能用。
 *
 * 设计要点:
 *   - 复用 AuthForm(纯展示, forwardRef + focusField(name))
 *   - 复用 (auth)/layout.tsx 的全局 .auth-title / .auth-title__char 类名 + auth-char-rise keyframe
 *   - 复用 .app-header 的 frosted-glass 配方 (overlay) + .auth-card 的 surface 配方 (dialog, 略加宽到 400px)
 *   - createPortal 到 document.body 防 z-index / overflow 冲突
 *   - body scroll lock + Esc 关闭 + overlay-click 关闭 + X 关闭
 *   - 最小 focus trap (~20 行) — 已知简化, 不引 focus-trap-react
 *
 * 简化说明 (写在文件顶部给后任):
 *   - 不处理: 外部 programmatic focus / screen-reader virtual cursor / IME composition
 *   - 覆盖路径: Esc + overlay-click + X + Tab/Shift+Tab 边界循环
 *   - 若以后 modal 内容变复杂, 改用 useEffect 重收集 focusable
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { safeRedirectPath } from '../../lib/safeRedirect';
import { useAuthModal } from '../../lib/authModal';
import { useAuthFormState } from '../_hooks/useAuthFormState';
import AuthForm from './AuthForm';
import styles from './AuthModal.module.css';

export default function AuthModal() {
  const { state, close, setMode } = useAuthModal();

  // SSR safety — don't touch document during render. The portal only
  // mounts on the client; the rest of the tree renders normally.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!state.open) return null;
  if (!mounted) return null;

  return createPortal(<AuthModalBody state={state} close={close} setMode={setMode} />, document.body);
}

interface AuthModalBodyProps {
  state: { open: boolean; mode: 'login' | 'signup'; from: string | null };
  close: () => void;
  setMode: (mode: 'login' | 'signup') => void;
}

function AuthModalBody({ state, close, setMode }: AuthModalBodyProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Where to land on success. Priority:
  //   1. state.from if supplied by the trigger (TranslationSession passes
  //      pathname+search; AppHeader passes '/' for now)
  //   2. window.location when on the client
  //   3. '/' fallback
  const redirectTo = useMemo(() => {
    const raw =
      state.from ??
      (typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/');
    return safeRedirectPath(raw, '/');
  }, [state.from]);

  const { formProps, formRef, submit } = useAuthFormState({
    mode: state.mode,
    redirectTo,
  });

  // Esc close — listen while open, unbind on close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // Body scroll lock while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Re-focus the failing field on errors change is owned by the hook
  // (via its own useEffect). For the modal we also want to focus
  // email on FIRST open — the hook's mount-time focus handles that
  // for the page; for the modal we delay the focus call ourselves so
  // the authModal-rise (400ms) and auth-char-rise can settle.
  // NB: useAuthFormState already autofocuses email 80ms after the
  // hook mounts — and since this ModalBody re-mounts whenever
  // state.open flips true, the hook's mount-focus fires correctly.

  const handleSubmit = useCallback(async () => {
    const ok = await submit();
    if (!ok) return;
    close();
    if (redirectTo && redirectTo !== '/') {
      router.replace(redirectTo);
    }
  }, [submit, close, redirectTo, router]);

  const handleAlt = useCallback(() => {
    setMode(state.mode === 'login' ? 'signup' : 'login');
  }, [setMode, state.mode]);

  // Minimal focus trap: Tab from last focusable → first; Shift+Tab
  // from first → last. Middle elements are left to the browser default.
  // See file-level comment for the (intentional) limitations.
  const onDialogKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      ),
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
  }, []);

  // Prevent overlay-click from firing when clicking inside dialog.
  const onDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const titleChars = state.mode === 'login' ? '欢迎回来' : '创建账号';

  return (
    <div className={styles.overlay} onClick={close} tabIndex={-1}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className={styles.dialog}
        onClick={onDialogClick}
        onKeyDown={onDialogKeyDown}
      >
        <button
          type="button"
          className={styles.close}
          aria-label="关闭"
          onClick={close}
        >
          ×
        </button>

        {/* Reuse the global .auth-title / .auth-title__char + auth-char-rise
            keyframe declared in (auth)/layout.tsx — same 4-char × 120ms
            stagger as the standalone /login and /signup pages. */}
        <h2 id="auth-modal-title" className={styles.title + ' auth-title'}>
          {Array.from(titleChars).map((char, i) => (
            <span
              key={i}
              className="auth-title__char"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {char}
            </span>
          ))}
        </h2>

        <AuthForm
          key={state.mode}
          ref={formRef}
          {...formProps}
          onAltClick={handleAlt}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
