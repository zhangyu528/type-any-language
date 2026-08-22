'use client';

/**
 * ThemeProvider — 全站 light/dark 切换(默认 dark)
 *
 * 2026-08 状态(注释修正,代码同步):
 *   - DEFAULT_THEME = dark(landing 优先 Galaxy + 深空蓝渐变)
 *   - 主题切换分两层:
 *     · desktop AppHeader nav 上的 sun/moon icon(匿名可见,快切)
 *     · /me/settings 完整 selector(登录用户偏好入口)
 *   - mobile hamburger menu 不再放主题项(2026-08 删,跟 desktop +
 *     /me/settings 重复,挤占转化 CTA"免费开始"位置)
 *   - localStorage 持久化保留,用户切回 light 后刷新页面仍生效。
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
/* landing 默认 dark(Galaxy + 深空蓝渐变 + 星空主题),
   2026-08 把 landing 调到 light 下的紫/单色调风格后,desktop nav
   保留 sun/moon icon 让匿名访客一键切回 dark;登录用户也可用
   /me/settings 的完整 selector 切换。 */
const DEFAULT_THEME: Theme = 'dark';

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