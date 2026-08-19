'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuthModal, setPostAuthNavigating } from '../../lib/authModal';
import { useAuth } from '../../lib/auth';
import { safeRedirectPath } from '../../lib/safeRedirect';
import ImmersiveAuth from './ImmersiveAuth';
import { apiLogin, apiSignup, ApiError } from '../../api';
import styles from './AuthModal.module.css';

export default function AuthModal() {
  const { state, close, setMode } = useAuthModal();
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ email: string } | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // createPortal 需要 document.body，仅客户端可用
  useEffect(() => {
    setMounted(true);
  }, []);

  // P0-D: 焦点还原 — modal 打开时抓当前焦点,关闭时还回去。
  // P3-A: focus trap — Tab/Shift+Tab 在 modal 内循环,不逃出去。
  useEffect(() => {
    if (state.open) {
      prevFocusRef.current = (document.activeElement as HTMLElement) ?? null;
      const id = requestAnimationFrame(() => {
        const root = document.querySelector('[data-auth-modal]');
        const target = (root?.querySelector(
          'input, button, [tabindex]:not([tabindex="-1"])',
        ) as HTMLElement | null);
        target?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
    setSubmitError(null);
    setSuccess(null);
    return undefined;
  }, [state.open]);

  // P-latest (msg 6): 滚动锁定 — modal 打开时冻结背景 landing 页的
  // 滚轮/触摸滚动,关闭时还原。与 ModalShell.tsx:98 一致:先捕获 body 原先的
  // overflow 值,cleanup 时还原,避免覆盖别处可能设置过 body overflow 的逻辑。
  // 放在最外层的 AuthModal(始终挂载),不能放在 AuthModalBody(仅在 open 时挂载)
  // —— 否则 open→close 时 body 已经卸载,无法还原。
  useEffect(() => {
    if (!state.open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [state.open]);

  // Focus trap inside the dialog. WAI-ARIA APG modal pattern:
  // collect all focusable elements, on Tab from the last wrap to the
  // first; on Shift+Tab from the first wrap to the last. Eye toggle
  // in CurvedInput is tabIndex=-1 (intentionally not in the cycle).
  useEffect(() => {
    if (!state.open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = document.querySelector('[data-auth-modal]');
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'input, button, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.open]);

  if (!mounted) return null;
  if (!state.open) return null;

  return createPortal(
    <AuthModalBody
      state={state}
      close={close}
      setMode={setMode}
      isLoading={isLoading}
      setIsLoading={setIsLoading}
      submitError={submitError}
      setSubmitError={setSubmitError}
      success={success}
      setSuccess={setSuccess}
    />,
    document.body,
  );
}

interface AuthModalBodyProps {
  state: { open: boolean; mode: 'login' | 'signup'; from: string | null; libName: string | null };
  close: () => void;
  setMode: (mode: 'login' | 'signup') => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  submitError: string | null;
  setSubmitError: (msg: string | null) => void;
  success: { email: string } | null;
  setSuccess: (s: { email: string } | null) => void;
}

function AuthModalBody({
  state,
  close,
  setMode,
  isLoading,
  setIsLoading,
  submitError,
  setSubmitError,
  success,
  setSuccess,
}: AuthModalBodyProps) {
  const router = useRouter();
  const { refresh } = useAuth();
  // Guard the close action while a submit is in flight: overlay click,
  // Esc, and the ✕ button all route through here. Closing mid-request
  // would strand the user — the cookie is set but refresh()/router.replace()
  // (which run after the await) would never fire, leaving the UI showing
  // the anonymous state with a logged-in session.
  const handleClose = useCallback(() => {
    if (isLoading) return;
    close();
  }, [isLoading, close]);
  const handleSubmit = useCallback(
    async (data: { email?: string; password?: string }) => {
      setIsLoading(true);
      setSubmitError(null);
      try {
        if (state.mode === 'login') {
          await apiLogin({ email: data.email!, password: data.password! });
        } else {
          await apiSignup({
            email: data.email!,
            password: data.password!,
          });
        }
        // 刷新 auth context 让 useAuth() 拿到新 user，再关 modal。
        // 避免任何依赖 user 状态的子树（header 头像、dashboard 守卫等）出现 flicker。
        // P1-D: signup 成功后渲染 ✅ + 欢迎语 600ms,再 close。
        // refresh 与 router 同时异步,让动画有机会播放。
        if (state.mode === 'signup') {
          setSuccess({ email: data.email! });
          await new Promise((resolve) => window.setTimeout(resolve, 600));
        }
        // 关键:在 refresh() 把 user 写入、触发根路由 app/page.tsx 的
        // 「已登录→/dashboard」重定向 effect 之前,同步置位 postAuthNavigating。
        // 必须早于 await refresh()(同微任务):refresh 内的 setUser 会安排一次
        // re-render,其 effect 在该微任务之后的微任务里先于本函数后续代码执行;
        // 若晚于此处置位,该 effect 会抢跑、把带 query 的落地目标
        // (/dashboard?welcome=1&lib=...) 清成裸 /dashboard。详见 lib/authModal.tsx 注释。
        setPostAuthNavigating(true);
        await refresh();
        // close modal 前先 navigate 到 state.from(/me?from=/me 等被守卫挡回的场景)。
        // safeRedirectPath 兜底非法 ?from= 值(协议相对 URL / 控制字符 / 太长等),
        // 无 from 时落到 /dashboard(登录后默认落脚)。
        const defaultTarget = state.mode === 'signup' ? '/dashboard?welcome=1' : '/dashboard';
        const target = safeRedirectPath(state.from, defaultTarget);
        router.replace(target);
        close();
      } catch (error) {
        // P3-E: 把不同 status code 映射成本地化的友好文案。
        // 注意:登录/注册失败(401/409/422 等)是用户侧的正常情况,不是 app
        // 崩溃,用 console.warn 而非 console.error,避免 devtools 里刷红色 error
        // 误导(错误文案已通过 setSubmitError 内联展示给用户)。
        console.warn("Auth rejected:", error);
        const label = state.mode === "login" ? "登录失败" : "注册失败";
        if (error instanceof ApiError) {
          if (error.status === 409) {
            setSubmitError(state.mode === "signup"
              ? "该邮箱已注册，换一个试试"
              : "登录失败：该邮箱已注册");
          } else if (error.status === 401) {
            setSubmitError("邮箱或密码不对，再试一次");
          } else if (error.status === 422) {
            setSubmitError(error.message || "请检查输入的格式");
          } else if (error.status >= 500) {
            setSubmitError("服务暂时开小差，稍后再试");
          } else {
            setSubmitError(error.message || label);
          }
        } else if (error instanceof Error) {
          setSubmitError("网络不太通，稍后重试");
        } else {
          setSubmitError(label);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [state.mode, setIsLoading, refresh, close, router, setSubmitError],
  );

  const handleSwitchMode = useCallback(() => {
    setMode(state.mode === 'login' ? 'signup' : 'login');
    setSubmitError(null);
  }, [state.mode, setMode, setSubmitError]);

  return (
    /* P2: outside-click no longer closes the modal — clicking the dim
       backdrop is easy to do by accident while filling the form and
       would silently discard typed email/password. Dismiss via the ✕
       button or Esc instead (both route through onClose → handleClose). */
    <div className={styles.overlay}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} data-auth-modal>
        <ImmersiveAuth
          mode={state.mode}
          onSubmit={handleSubmit}
          onSwitchMode={handleSwitchMode}
          isLoading={isLoading}
          onClose={handleClose}
          submitError={submitError}
          onClearSubmitError={() => setSubmitError(null)}
          success={success}
          libName={state.libName}
        />
      </div>
    </div>
  );
}
