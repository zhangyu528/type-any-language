import styles from './Waveform.module.css';

/**
 * Waveform — 声波条(产品"听"的视觉签名)
 *
 * playing=false 时低幅静止;playing=true 时各条按错位节奏起伏。
 * 后续接 Web Audio 频谱时,可用 levels 直接驱动每根条的高度。
 */

export interface WaveformProps {
  playing?: boolean;
  /** 0-1 的实时频谱值;给了就跳过 CSS 动画,直接受控渲染 */
  levels?: readonly number[];
  bars?: number;
  className?: string;
}

export default function Waveform({
  playing = false,
  levels,
  bars = 24,
  className,
}: WaveformProps) {
  const count = levels?.length ?? bars;
  return (
    <span
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      data-playing={playing}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={styles.bar}
          style={
            levels
              ? { height: `${Math.max(8, Math.round((levels[i] ?? 0) * 100))}%` }
              : { animationDelay: `${(i % 7) * 90}ms` }
          }
        />
      ))}
    </span>
  );
}
