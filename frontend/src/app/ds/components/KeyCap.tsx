import styles from './KeyCap.module.css';

/**
 * KeyCap — 键盘键帽(2.5px 薄荷底边模拟键程)
 * 用于快捷键提示:⏎ enter、esc、space…
 */

export interface KeyCapProps {
  children: React.ReactNode;
  className?: string;
  'aria-hidden'?: boolean;
}

export default function KeyCap({ children, className, 'aria-hidden': ariaHidden }: KeyCapProps) {
  return (
    <kbd
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      aria-hidden={ariaHidden}
    >
      {children}
    </kbd>
  );
}
