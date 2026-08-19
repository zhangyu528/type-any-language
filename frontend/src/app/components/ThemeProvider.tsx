'use client';

/**
 * ThemeProvider — 全站 light/dark 切换(默认 dark)
 *
 * 2026-08 改:DEFAULT_THEME 改为 dark,AppHeader 移除 ThemeToggle 按钮
 * (主题切换从全局 nav 入口降到 /me/settings 偏好项)。
 * localStorage 持久化逻辑保留,用户切回 light 后刷新页面仍生效。
 *
 * 之前的工作方式(参考):
 *
 * 工作方式:
 *   - 在 <html> 上写 `data-theme="light" | "dark"`,ds/themes.css 用
 *     `[data-theme="dark"]` 选择器整组切换 --ds-* 语义 token
 *   - 持久化到 localStorage['landing.theme'];未手动选择时跟随系统
 *   - 首屏不闪:layout.tsx <head> 里的 bootstrap 脚本在 React
 *     hydration 前同步写入 data-theme
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'landing.theme';
const DEFAULT_THEME: Theme = 'dark'; /* 2026-08 改:AppHeader 去掉 ThemeToggle,landing 默认走 dark
   (Galaxy + 深空蓝渐变 + 星空主题)。用户可在 /me/settings 手动切回 light。 */

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

  /* toggleTheme:从 ThemeContext 暴露的便捷方法,navheader / floating 按钮用。
     避免在调用处重复写 setTheme(theme === 'light' ? 'dark' : 'light')。 */
  const toggleTheme = useCallback(() => {
    setAndPersist(theme === 'light' ? 'dark' : 'light');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setAndPersist, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/* ------- context + hook ------- */

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}