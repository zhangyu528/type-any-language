'use client';

import { useTheme } from './ThemeProvider';
import IconButton from '../ds/components/IconButton';

/**
 * ThemeToggle — light / dark 切换按钮
 *
 * 28×28 圆形 ghost IconButton,内嵌 sun / moon 图标。点击翻转
 * html[data-theme],ThemeProvider 同步到 localStorage。
 *
 * 视觉(sm + ghost + circle):
 *   - 默认 fill 透明,描边 --ds-border
 *   - hover fill 用 --ds-tint 淡底 + --ds-action-deep
 *   - 图标旋转过渡 250ms
 */

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.5" />
      <line x1="12" y1="2.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21.5" y2="12" />
      <line x1="5.2" y1="5.2" x2="7" y2="7" />
      <line x1="17" y1="17" x2="18.8" y2="18.8" />
      <line x1="5.2" y1="18.8" x2="7" y2="17" />
      <line x1="17" y1="7" x2="18.8" y2="5.2" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  const next = isDark ? 'light' : 'dark';
  const label = isDark ? '切换到浅色' : '切换到深色';

  return (
    <IconButton
      variant="ghost"
      size="sm"
      shape="circle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </IconButton>
  );
}