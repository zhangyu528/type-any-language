import styles from './BubbleCard.module.css';

/**
 * BubbleCard — 白卡片浮于薄荷底(e0 描边,可选 hover 浮起)
 */

export interface BubbleCardProps {
  children: React.ReactNode;
  /** hover 时上浮 1px + e1 阴影(用于可点击卡片) */
  interactive?: boolean;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
}

export default function BubbleCard({
  children,
  interactive = false,
  className,
  as: Tag = 'div',
}: BubbleCardProps) {
  const cls = [
    styles.root,
    interactive ? styles.interactive : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <Tag className={cls}>{children}</Tag>;
}
