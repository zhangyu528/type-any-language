'use client';

/**
 * LetterReveal — 逐字 fade-in 文本揭示(一次性,揭示后保留)
 *
 * 设计用途:Section 1 Step 2「写」演示。参考 Hero TypefallDemo 的字符
 * 动画样式,每个字符独立 span + opacity 0→1 切换。
 *
 * 跟 DecryptedText 的区别:
 *   - DecryptedText:字符随机化后逐步还原(打乱式)
 *   - LetterReveal:字符从 opacity:0 平稳淡入(打字式)
 *
 * 一次性揭示:字符逐字 fade-in,全部揭示后**保留**在屏幕,不循环不淡出。
 * 用户看完就可以读完整句,不需要重新触发。
 *
 * 视觉节奏:
 *   charStaggerMs 默认 120ms(每字间隔)
 *   全部揭示耗时:text.length * charStaggerMs
 *   例:24 字 * 120ms = 2880ms 揭示完整句
 */

import { useEffect, useState } from 'react';
import styles from './LetterReveal.module.css';

interface LetterRevealProps {
  text: string;
  charStaggerMs?: number;
}

export default function LetterReveal({
  text,
  charStaggerMs = 120,
}: LetterRevealProps) {
  const [now, setNow] = useState(0);
  const totalRevealMs = text.length * charStaggerMs;

  useEffect(() => {
    // 全部揭示完成即停止 tick(节省 CPU),揭示后字符永远保持 visible
    if (now >= totalRevealMs) return;
    const id = window.setInterval(() => setNow((t) => t + 80), 80);
    return () => window.clearInterval(id);
  }, [now, totalRevealMs]);

  return (
    <span className={styles.root} aria-label={text}>
      {text.split('').map((ch, ci) => {
        const charStart = ci * charStaggerMs;
        // 揭示后永远 visible(opacity:1,不再 fade out)
        const visible = now >= charStart;
        return (
          <span
            key={ci}
            className={styles.char}
            style={{ opacity: visible ? 1 : 0 }}
            aria-hidden
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}