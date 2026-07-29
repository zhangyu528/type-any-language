'use client';

/**
 * ThemeProvider — 着陆页 light/dark 切换
 *
 * 工作方式:
 *   - 在 <html> 上写 `data-theme="light" | "dark"`,CSS 用
 *     `[data-theme="dark"] .app-header--landing` 等选择器覆盖
 *     --cm-* token
 *   - 持久化到 localStorage.theme (默认 light,**不**跟随系统)
 *   - 首屏在 SSR 阶段不会闪——client mount 后立即读 localStorage
 *     并同步到 <html>
 *
 * 范围:只管着陆页。--heal-* / --surface-* 等后端 token 不动,
 * 后端页面在 dark 下保持原亮色(它们没配 dark 覆盖)。
 *
 * Why client component:
 *   - 需要读 localStorage
 *   - 需要直接动 <html> 属性(不是 React state)
 *   - 它的 children 通常是 layout 的子树,所以放在 <html> 之外
 *     也可以,但为了 SSR 干净,我们让它跑在 <body> 顶层
 */

import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'landing.theme';
const DEFAULT_THEME: Theme = 'light';

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* 隐私模式静默 */
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  // 同时给 html meta 提示,让浏览器 UI(form 控件滚动条)也跟着走
  document.documentElement.style.colorScheme = theme;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 首屏用 DEFAULT_THEME 渲染避免 SSR/CSR 不一致;mount 后立即同步到真实值
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const setAndPersist = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 静默 */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setAndPersist }}>
      {children}
    </ThemeContext.Provider>
  );
}

/* ------- context + hook ------- */

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}