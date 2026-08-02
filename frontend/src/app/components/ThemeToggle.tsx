'use client';

import { useTheme } from './ThemeProvider';
import styles from './ThemeToggle.module.css';

/**
 * ThemeToggle — light / dark 切换按钮
 *
 * 28×28 圆形按钮,内嵌 sun / moon 图标。点击翻转 html[data-theme],
 * ThemeProvider 同步到 localStorage。
 *
 * 视觉:
 *   - 默认 fill 透明,描边 ink-soft 0.3
 *   - hover fill 用 --ds-action 淡底 + ink
 *   - 图标旋转过渡 200ms
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      className={styles.root}
      onClick={() => setTheme(next)}
      aria-label={isDark ? '切换到浅色' : '切换到深色'}
      title={isDark ? '切换到浅色' : '切换到深色'}
    >
      <span
        className={`${styles.icon} ${isDark ? styles.iconMoon : styles.iconSun}`}
        aria-hidden="true"
      >
        {isDark ? (
          // moon
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          // sun
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
            <line x1="12" y1="2"  x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2"  y1="12" x2="5"  y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
            <line x1="4.5"  y1="4.5"  x2="6.6"  y2="6.6" />
            <line x1="17.4" y1="17.4" x2="19.5" y2="19.5" />
            <line x1="4.5"  y1="19.5" x2="6.6"  y2="17.4" />
            <line x1="17.4" y1="6.6"  x2="19.5" y2="4.5" />
          </svg>
        )}
      </span>
    </button>
  );
}