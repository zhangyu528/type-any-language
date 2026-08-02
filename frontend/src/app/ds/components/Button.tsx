import { forwardRef } from 'react';
import styles from './Button.module.css';

/**
 * Button — TAL Mint 标准按钮(pill 形)
 *
 * variant: primary(薄荷填充) / cta(珊瑚填充,一页至多一处) / ghost(描边)
 * size:    sm(32) / md(40) / lg(48)
 * 五态:hover 浮 1px / active 回位 / focus-visible 环 / disabled 40% / loading spinner
 */

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'cta' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...rest },
  ref,
) {
  const cls = [
    styles.root,
    styles[variant],
    styles[size],
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className={styles.spinner} aria-hidden /> : null}
      <span className={styles.label}>{children}</span>
    </button>
  );
});

export default Button;
