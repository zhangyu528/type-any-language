'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './TypefallDemo.module.css';

interface TypefallDemoProps {
  /** 整句打完(typing → done)时回调一次 */
  onPhase?: (phase: 'typing' | 'done') => void;
  /** 每完成一个单词回调一次(传单词下标),用于驱动逐词外发光 */
  onWord?: (wordIndex: number) => void;
}

const EN_CHAR_STAGGER = 65; // ms/字 ≈ 15 字每秒(轻快但可读)
const CHAR_TYPE = 260; // 单字落字 pop 时长
const WORD_GAP = 220; // 词间停顿
const LEAD_IN = 600; // 句首停顿
const DONE_HOLD = 1800; // 整句打完停留,之后重置进入新句

const EN_SENTENCE = "today's weather is nice";

interface CharCell {
  ch: string;
  word: number;
  start: number;
  end: number;
}

function buildSchedule(sentence: string) {
  const words = sentence.split(' ');
  const cells: CharCell[] = [];
  let t = LEAD_IN;
  words.forEach((w, wi) => {
    [...w].forEach((ch) => {
      cells.push({ ch, word: wi, start: t, end: t + CHAR_TYPE });
      t += EN_CHAR_STAGGER;
    });
    t += WORD_GAP;
  });
  const fullDone = t - WORD_GAP; // 最后一个词尾 + 末词 gap 前
  return { cells, words, fullDone };
}

export default function TypefallDemo({ onPhase, onWord }: TypefallDemoProps) {
  const { cells, words, fullDone } = useMemo(() => buildSchedule(EN_SENTENCE), []);
  const [now, setNow] = useState(0);
  const prevSettled = useRef(0);
  const phaseRef = useRef<'typing' | 'done'>('typing');

  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      // 循环:整句打完 + 停留后重置进入新句
      if (elapsed >= fullDone + DONE_HOLD) {
        start = performance.now();
        prevSettled.current = 0;
        setNow(0);
        if (phaseRef.current !== 'typing') {
          phaseRef.current = 'typing';
          onPhase?.('typing');
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      setNow(elapsed);

      // 词级进度 → 触发逐词回调
      let settled = 0;
      for (let wi = 0; wi < words.length; wi++) {
        const lastChar = cells.filter((c) => c.word === wi).at(-1);
        if (lastChar && elapsed >= lastChar.end) settled++;
        else break;
      }
      if (settled > prevSettled.current) {
        for (let i = prevSettled.current; i < settled; i++) onWord?.(i);
        prevSettled.current = settled;
      }

      // 整句完成
      if (elapsed >= fullDone && phaseRef.current !== 'done') {
        phaseRef.current = 'done';
        onPhase?.('done');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cells, words, fullDone, onPhase, onWord]);

  const total = cells.length;
  const settled = cells.filter((c) => now >= c.start).length;
  const progressPct = total === 0 ? 0 : Math.round((settled / total) * 100);

  return (
    <div className={styles.demoRoot}>
      <div className={styles.demoProgress}>
        <span className={styles.demoProgressFill} style={{ width: `${progressPct}%` }} />
      </div>

      {/* 中文题面(读什么) */}
      <p className={styles.demoZh}>今天天气真好</p>

      {/* 英文跟打(写什么):逐字 fade + 落字 pop */}
      <div className={styles.demoEnRow} aria-label={EN_SENTENCE}>
        {cells.map((c, i) => {
          const visible = now >= c.start;
          const arriving = visible && now < c.end;
          return (
            <span
              key={i}
              className={`${styles.demoChar} ${arriving ? styles.demoCharArriving : ''}`}
              style={{ opacity: visible ? 1 : 0 }}
            >
              {c.ch === ' ' ? ' ' : c.ch}
            </span>
          );
        })}
      </div>
    </div>
  );
}
