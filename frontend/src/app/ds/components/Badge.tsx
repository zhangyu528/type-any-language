import styles from './Badge.module.css';

/**
 * Badge — 幕编号 / 状态 chip(tint 底 + action-deep 字)
 * tone: mint(默认) / coral(警示、错题)
 */

export interface BadgeProps {
  children: React.ReactNode;
  tone?: 'mint' | 'coral';
  className?: string;
}

export default function Badge({ children, tone = 'mint', className }: BadgeProps) {
  const cls = [
    styles.root,
    tone === 'coral' ? styles.coral : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>{children}</span>;
}
