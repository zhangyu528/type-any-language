'use client';

/**
 * ThemeProvider — 全站 light/dark 切换(TAL Mint)
 *
 * 工作方式:
 *   - 在 <html> 上写 `data-theme="light" | "dark"`,ds/themes.css 用
 *     `[data-theme="dark"]` 选择器整组切换 --ds-* 语义 token
 *   - 持久化到 localStorage['landing.theme'];未手动选择时跟随系统
 *   - 首屏不闪:layout.tsx <head> 里的 bootstrap 脚本在 React
 *     hydration 前同步写入 data-theme
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