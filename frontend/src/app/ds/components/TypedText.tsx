import styles from './TypedText.module.css';

/**
 * TypedText — 打字字符五态渲染(DS 核心组件)
 *
 * 纯展示组件:给定文本 + 每字符状态 + 光标位置,负责
 * 正确渲染五态视觉(untyped / correct / error / current / caret)。
 * 状态机逻辑(输入判定、时序演示)由消费方持有 ——
 * landing 的 TypefallDemo、practice 的输入处理共用此渲染层,
 * 保证"字符五态"全站只有这一处实现。
 *
 * 视觉规格(themes.css):
 *   untyped → --ds-char-untyped
 *   correct → --ds-char-correct
 *   error   → --ds-char-error + --ds-char-error-line 下划线
 *   caret   → --ds-caret 圆头竖条
 */

export type CharState = 'untyped' | 'correct' | 'error' | 'current';

export interface TypedTextProps {
  text: string;
  /** 每字符状态;缺省全部 untyped。长度不足时按 untyped 补齐。 */
  states?: readonly CharState[];
  /** 光标落在第几字符前;不传或 <0 表示隐藏 */
  caret?: number;
  className?: string;
  ariaLabel?: string;
}

export default function TypedText({
  text,
  states,
  caret,
  className,
  ariaLabel,
}: TypedTextProps) {
  const chars = Array.from(text);
  return (
    <span
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      role="text"
      aria-label={ariaLabel ?? text}
    >
      {chars.map((ch, i) => {
        const st = states?.[i] ?? 'untyped';
        const cls =
          st === 'correct'
            ? styles.correct
            : st === 'error'
              ? styles.error
              : st === 'current'
                ? styles.current
                : styles.untyped;
        return (
          <span key={i} className={styles.slot} aria-hidden>
            {caret === i ? <span className={styles.caret} /> : null}
            <span className={cls}>{ch === ' ' ? ' ' : ch}</span>
          </span>
        );
      })}
      {caret != null && caret >= chars.length ? (
        <span className={styles.slot} aria-hidden>
          <span className={styles.caret} />
        </span>
      ) : null}
    </span>
  );
}
