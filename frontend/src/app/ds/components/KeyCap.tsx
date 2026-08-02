import styles from './KeyCap.module.css';

/**
 * KeyCap — 键盘键帽(2.5px 薄荷底边模拟键程)
 * 用于快捷键提示:⏎ enter、esc、space…
 */

export interface KeyCapProps {
  children: React.ReactNode;
  className?: string;
}

export default function KeyCap({ children, className }: KeyCapProps) {
  return (
    <kbd className={`${styles.root}${className ? ` ${className}` : ''}`}>
      {children}
    </kbd>
  );
}
