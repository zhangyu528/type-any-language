'use client';

/**
 * AuthModalProvider — 全局 modal 开关上下文。
 *
 * 为什么独立: AuthModal.tsx (consumer) 与 provider 拆开避免循环引用,
 * 镜像 app/lib/auth.tsx 的 Provider + hook 模式。
 *
 * 触发点 (3 处):
 *   - AppHeader 「登录」/「注册」按钮
 *   - TranslationSession 提示卡的 onLogin (内部 PracticeHintCard 转发)
 *
 * 不抢: /me 匿名守卫仍走整页 router.replace('/login?from=/me'),
 * 直访 /login?from= 也走整页 — modal 只服务 in-app 触发。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type AuthMode = 'login' | 'signup';

interface AuthModalState {
  open: boolean;
  mode: AuthMode;
  /** 成功后落点。null = 留在 modal 关闭前的页。 */
  from: string | null;
}

interface AuthModalContextValue {
  open: (mode: AuthMode, opts?: { from?: string }) => void;
  close: () => void;
  /** 内部 alt-link 「没有账号?注册」用 — 不关 modal,只切 mode
   *  (modal 用 key={state.mode} 强制重挂 AuthForm,输入值/密码显示全重置)。 */
  setMode: (mode: AuthMode) => void;
  state: AuthModalState;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

const INITIAL_STATE: AuthModalState = { open: false, mode: 'login', from: null };

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthModalState>(INITIAL_STATE);

  const open = useCallback((mode: AuthMode, opts?: { from?: string }) => {
    setState({ open: true, mode, from: opts?.from ?? null });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
    // 保留 mode/from 给下次 — 用户多半同向操作, 减少一次 setState。
  }, []);

  const setMode = useCallback((mode: AuthMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const value = useMemo<AuthModalContextValue>(
    () => ({ open, close, setMode, state }),
    [open, close, setMode, state],
  );

  return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) {
    throw new Error('useAuthModal must be used inside <AuthModalProvider>');
  }
  return ctx;
}
