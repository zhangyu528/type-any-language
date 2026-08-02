import { forwardRef } from 'react';
import styles from './IconButton.module.css';

/**
 * IconButton — 图标按钮(只有图标,无文字)
 *
 * variant:
 *   primary   薄荷填充,适合头版主操作(右上主题切换不归此类)
 *   ghost     透明底 + 描边,AppHeader / ThemeToggle 这种最常见
 *   bare      完全无背景无描边,贴在已有装饰物上(例:卡片右上角关闭)
 * size:
 *   sm (28)  AppHeader 内的紧凑按钮
 *   md (40)  弹窗 / 卡片次级
 *   lg (48)  显眼空操作
 * shape:
 *   circle   圆形,贴图标自然
 *   square   方形(小圆角),给有方块感的图标(svg 含 grid)
 *
 * 五态:hover 浮 1px / active 回位 / focus-visible 环 / disabled 40% /
 * loading 占位(保留 aria-label,但内容替换为旋转的细环)。
 */

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'ghost' | 'bare';
  size?: 'sm' | 'md' | 'lg';
  shape?: 'circle' | 'square';
  loading?: boolean;
  /** Accessible label — required,因为按钮里只有图标 */
  'aria-label': string;
  children: React.ReactNode;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      variant = 'ghost',
      size = 'md',
      shape = 'circle',
      loading = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const cls = [
      styles.root,
      styles[variant],
      styles[size],
      styles[shape],
      loading ? styles.loading : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <button
        ref={ref}
        type="button"
        className={cls}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? <span className={styles.spinner} aria-hidden /> : children}
      </button>
    );
  },
);

export default IconButton;