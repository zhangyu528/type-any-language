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
  /** 从 landing 选了某个词库再注册时,带入词库名,让注册弹窗显示
   *  "注册后开始《X》"的上下文;普通注册为 null。 */
  libName: string | null;
}

interface AuthModalContextValue {
  open: (mode: AuthMode, opts?: { from?: string; libName?: string | null }) => void;
  close: () => void;
  /** 内部 alt-link 「没有账号?注册」用 — 不关 modal,只切 mode
   *  (modal 用 key={state.mode} 强制重挂 AuthForm,输入值/密码显示全重置)。 */
  setMode: (mode: AuthMode) => void;
  state: AuthModalState;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

const INITIAL_STATE: AuthModalState = { open: false, mode: 'login', from: null, libName: null };

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthModalState>(INITIAL_STATE);

  const open = useCallback((mode: AuthMode, opts?: { from?: string; libName?: string | null }) => {
    setState({ open: true, mode, from: opts?.from ?? null, libName: opts?.libName ?? null });
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

/**
 * postAuthNavigating — 注册/登录成功后、AuthModal 即将 router.replace 到带
 * query 的目标(如 /dashboard?welcome=1&lib=...)时置位的瞬时标记。
 *
 * 为什么需要：根路由 app/page.tsx 有一个「已登录用户从 / 重定向到 /dashboard」
 * 的 effect,它会在 user 变为已登录的同一帧里竞争性地调用 router.replace('/dashboard'),
 * 把 signup 落地 URL 的 ?welcome=1&lib=... query 整体清掉(后者晚于 modal 的
 * router.replace 提交,赢下最终 URL)。置位后让根重定向跳过本次,交给 AuthModal
 * 接管导航;着陆 /dashboard 后 landing 卸载,cleanup 复位标记,不影响后续访问。
 *
 * 用模块级变量而非 context state:置位需在与 setUser 同帧、modal 导航之前同步
 * 生效,且 landing 的 effect 直接同步读取即可,无需触发额外 re-render。
 */
let postAuthNavigating = false;

export function setPostAuthNavigating(value: boolean): void {
  postAuthNavigating = value;
}

export function isPostAuthNavigating(): boolean {
  return postAuthNavigating;
}
