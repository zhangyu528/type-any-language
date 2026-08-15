'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRandomSentences, type LessonSentence } from '../api';
import styles from './TypefallDemo.module.css';

interface TypefallDemoProps {
  /** 当前练习的词库 id。传了就从 /api/sentences/random 拉 3 句轮播;
   *  不传或拉取失败时退回 FALLBACK_SENTENCE(保证 未登录态 / 网络故障下
   *  demo 卡不空)。Hero.tsx 已经传 firstLib?.id 进来。 */
  libId?: string;
}

const EN_CHAR_STAGGER = 150; // ms/字 ≈ 7 字每秒(per-letter 清晰可读)
const CHAR_TYPE = 150; // 单字 arriving 窗口 = 动画时长 150ms,动画跑完立刻移除 .demoCharArriving
const WORD_GAP = 500; // 词间停顿:保证视觉词间距 = stagger(150) + WORD_GAP(500) - CHAR_TYPE(380) = 270ms
const LEAD_IN = 700; // 句首停顿(期待感)
const DONE_HOLD = 1400; // 整句打完停留(总 cycle ≈ 5.5s,适配慢节奏)
const FETCH_OVERSHOOT = 10; // 多拉点,过滤 ≤80 字符后仍够 5 句轮播
const SENTENCE_MAX_LEN = 80; // 单句字符上限:超长句节奏拖沓,过滤掉

/* Fallback —— 无 libId / fetch 失败 / 返回空数组时用。
   跟旧版 hero demo 视觉一致,保证回归 0。 */
const FALLBACK_SENTENCE: LessonSentence = {
  id: 'fallback',
  text: "today's weather is nice",
  chinese_text: '今天天气真好',
  difficulty: 'beginner',
  audio_url: '',
};

const SENTENCE_ROTATION_COUNT = 5; // 一次轮 5 句,过滤长句后仍够
const SENTENCE_DIFFICULTY = 'beginner'; // hero demo 用最简单档,跟产品对「零门槛」承诺一致

interface CharCell {
  ch: string;
  word: number;
  start: number;
  end: number;
  /* 词间空格标记 —— 渲染时套 .demoCharSpace 给定宽,不参与 punch 动画。 */
  isSpace?: boolean;
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
    if (wi < words.length - 1) {
      /* 词间空格 cell:跨整个词视觉 gap。
         视觉 gap = stagger + WORD_GAP - CHAR_TYPE(看 WORD_GAP 注释),
         空格 cell 时长 = visual gap = WORD_GAP - EN_CHAR_STAGGER。 */
      cells.push({
        ch: ' ',
        word: wi,
        start: t,
        end: t + WORD_GAP - EN_CHAR_STAGGER,
        isSpace: true,
      });
    }
    t += WORD_GAP;
  });
  const fullDone = t - WORD_GAP; // 最后一个词尾 + 末词 gap 前
  return { cells, words, fullDone };
}

export default function TypefallDemo({ libId }: TypefallDemoProps) {
  /* 句子队列 + 索引。初始就是 FALLBACK_SENTENCE,保证首屏不空;
     fetch 回来后整组替换,索引归 0 —— 让用户从第一句真实句开始看。 */
  const [sentences, setSentences] = useState<LessonSentence[]>([FALLBACK_SENTENCE]);
  const [idx, setIdx] = useState(0);
  const sentence = sentences[idx] ?? FALLBACK_SENTENCE;

  /* 数据拉取:有 libId 就去后台,失败/空数组时静默保持 fallback。
     取消标记 cancelled 防 libId 切换时旧请求覆盖新数据。
     - 多拉 FETCH_OVERSHOOT 句,过滤掉超长句(> SENTENCE_MAX_LEN 字符,
       节奏拖沓 hero demo 体验差)后取前 SENTENCE_ROTATION_COUNT;
     - 过滤后空数组退回原列表(避免空过滤导致 fallback)。 */
  useEffect(() => {
    if (!libId) return;
    let cancelled = false;
    fetchRandomSentences(libId, FETCH_OVERSHOOT, SENTENCE_DIFFICULTY).then(
      (res) => {
        if (cancelled) return;
        if (!Array.isArray(res) || res.length === 0) return;
        const filtered = res.filter((s) => s.text.length <= SENTENCE_MAX_LEN);
        const final = (filtered.length > 0 ? filtered : res).slice(0, SENTENCE_ROTATION_COUNT);
        setSentences(final);
        setIdx(0);
      },
      () => { /* fetch 失败 → 保持 fallback,不动状态 */ },
    );
    return () => { cancelled = true; };
  }, [libId]);

  /* 排程依赖当前句 —— 句切换时(cross-fade 重置 + 句尾轮播)useMemo 重新算 cells。
     EN_SENTENCE 字面常量被消除:动画数据完全由 sentence.text 驱动。 */
  const { cells, words, fullDone } = useMemo(
    () => buildSchedule(sentence.text),
    [sentence.text],
  );
  const [now, setNow] = useState(0);




  /* 用 ref 跟踪句长,避免轮播时 useEffect deps 频繁变化导致动画重启抖动。 */
  const sentencesLenRef = useRef(sentences.length);
  sentencesLenRef.current = sentences.length;


  useEffect(() => {
    /* 用 let 而不是 const,因为循环重置分支(start = performance.now() - elapsed)
       需要重新赋值来开始新一轮。 */
    let start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      // 循环:整句打完 + 停留后重置进入下一句
      if (elapsed >= fullDone + DONE_HOLD) {
        start = performance.now() - elapsed; /* 新一轮从 0 起 */
        setNow(0);
        /* 句尾轮播:只在有真实多句时才前进,避免 fallback 单句原地空转。 */
        setIdx((i) => {
          const len = sentencesLenRef.current;
          return len > 1 ? (i + 1) % len : 0;
        });
        raf = requestAnimationFrame(tick);
        return;
      }
      setNow(elapsed);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cells, words, fullDone]);

  const total = cells.length;
  const visibleCount = cells.filter((c) => now >= c.start).length;
  const progressPct = total === 0 ? 0 : Math.round((visibleCount / total) * 100);

  return (
    <div className={styles.demoRoot}>
      {/* 进度条:放 demoRoot 顶部 —— 跟 mockTopbar 紧贴,作为 "chrome 状态条"。
         跟顶部 nav bar(浏览器三个点 + lib 名)视觉同类 —— 都是
         "当前状态指示器",进度条管 demo 状态,topbar 管 lib 上下文。 */}
      <div className={styles.demoProgress}>
        <span className={styles.demoProgressFill} style={{ width: `${progressPct}%` }} />
      </div>

      {/* 中文题面(读什么) —— 从 sentence.chinese_text 驱动,fallback 时硬编码。 */}
      <p className={styles.demoZh}>{sentence.chinese_text}</p>

      {/* 英文跟打(写什么):逐字 fade-in —— 打字机式,字符在原位出现 */}
      <div className={styles.demoEnRow} aria-label={sentence.text}>
        {cells.map((c, i) => {
          const visible = now >= c.start;
          const arriving = visible && now < c.end;
          const isSpace = c.isSpace === true;
          return (
            <span
              key={i}
              className={
                isSpace
                  ? styles.demoCharSpace
                  : `${styles.demoChar} ${arriving ? styles.demoCharArriving : ''}`
              }
              style={{ opacity: visible ? 1 : 0 }}
              aria-hidden={isSpace ? 'true' : undefined}
            >
              {c.ch}
            </span>
          );
        })}
      </div>
    </div>
  );
}
