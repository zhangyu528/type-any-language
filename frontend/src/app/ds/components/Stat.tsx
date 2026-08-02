import styles from './Stat.module.css';

/**
 * Stat — 统计数字(mono 大字 + caption 标签)
 * tone: ink(默认) / mint / coral
 */

export interface StatProps {
  value: React.ReactNode;
  label: string;
  tone?: 'ink' | 'mint' | 'coral';
  className?: string;
}

export default function Stat({ value, label, tone = 'ink', className }: StatProps) {
  const toneCls =
    tone === 'mint' ? styles.mint : tone === 'coral' ? styles.coral : styles.ink;
  return (
    <span className={`${styles.root}${className ? ` ${className}` : ''}`}>
      <span className={`${styles.value} ${toneCls}`}>{value}</span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
