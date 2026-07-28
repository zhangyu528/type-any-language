'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * TypefallDemo — hero 区域"中→英听写"微观动作演示
 *
 * 与实际练习 1:1 对齐:
 *   - 中文先到(作为要翻译的题目),灰色小字提示
 *   - 英文逐词填入,每个单词**先有下划线占位**,然后逐字符浮现
 *     到占位之上,字符从 --label-quaternary 漂到 --label-primary
 *   - 整词完成后"判断":若该词是预选的错改演示词,先停顿一会
 *     (代表"刚刚输完") → flash 错误效果(朱砂色背景 + line-through,
 *     持续约 600ms) → 字符全部 fade-out → 重新逐字符输入正确版本
 *     → 最终落定为 --label-primary
 *   - 修正完成后,该词后面的输入再继续,且**修正后停顿 320ms** 让用户
 *     看清"已改好"。
 *   - 整组**不淡出**:容器常驻,内容原地替换(React 用 key 切下一句)
 *
 * 节奏设计 ——「真人翻译」的微观动作:
 *   - 词内字符:30-80ms 抖动
 *   - 词间停顿:80-160ms(代表"回忆下一个词")
 *   - 错改词判断延迟:settle 完成后 +200ms(代表"看着刚输的")
 *   - flash 错误效果:~600ms(朱砂红 wash)
 *   - fade-out 重输:380ms(整词消失)
 *   - 重输 settle 与初输节奏一致(逐字符 settle)
 *   - 修正后停顿:RECOVERY_PAUSE = 320ms(代表"反应过来")
 */
const DEMOS: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: '我每天早上喝咖啡。', en: 'I drink coffee every morning.' },
  { zh: '你下周有什么计划？', en: 'What are your plans next week?' },
  { zh: '这个想法很有趣。', en: 'That is a really interesting idea.' },
];

// 时间线常量(ms)—— 调整这里改节奏
const ZH_BASE_DELAY = 60;
const ZH_CHAR_STAGGER = 28;
const EN_BASE_DELAY = 220;
const EN_SETTLE_DURATION = 380;
const JUDGE_DELAY = 200;            // 词 settle 完之后,代表"判断中"
const FLASH_DURATION = 600;         // 错误 flash 持续时间
const FADE_OUT_DURATION = 280;      // 整词 fade-out(字符)
const RETYPE_PAUSE = 80;            // fade-out 到重输 settle 的间隔
const RECOVERY_PAUSE = 320;         // 修正后停顿("反应过来")
const DWELL_AFTER_FULL = 1400;      // 整句完成后停留(用户能看清)
const LOOP_PAUSE = 320;             // 切下一句前的间隔

interface WordMeta {
  /** 词文本,如 "drink" */
  text: string;
  /** 错改词专属:整词中**只一个字符**被替换为相似形,长度 = text.length,
   *  但只有 wrongCharIdx 那个位置字符是错字,其余与 text 一致。
   *  非错改词为 null。 */
  wrongChars: string[] | null;
  /** 错改词被选中的字符 idx(0-based),错字符在 wrongChars[wrongCharIdx]。 */
  wrongCharIdx: number | null;
  /** 该词的字符在原字符串中的起始 idx(包含空格也算) */
  startIdx: number;
  /** "判断时刻" = 该词最后字符 settle 完成 + JUDGE_DELAY */
  judgeAt: number;
  /** "flash 阶段开始" = judgeAt */
  flashAt: number;
  /** "fade-out 阶段开始" = flashAt + FLASH_DURATION */
  fadeOutAt: number;
  /** "重输正确 settle 开始" = fadeOutAt + RETYPE_PAUSE */
  retypeAt: number;
  /** "最终落定完成" = retypeAt + EN_SETTLE_DURATION × 字符数 + 各字符 jitter */
  endAt: number;
  /** 是否为错改演示词 */
  isErrorWord: boolean;
}

/** Split en into words; record each word's char-index range in the original string. */
function tokenizeWords(en: string): { text: string; startIdx: number }[] {
  const out: { text: string; startIdx: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(en)) !== null) {
    out.push({ text: m[0], startIdx: m.index });
  }
  return out;
}

/** Hash-based jitter (deterministic). Mixing Math.random() into a
 *  useMemo would make the timings mutate on every render, which in
 *  turn retriggers effect deps and yields a "setState during render"
 *  warning. Using a hash keeps the same per-(index, char) jitter
 *  across renders. */
function hashJitter(seed: number, lo: number, hi: number): number {
  let h = seed >>> 0;
  h = (h ^ (h >>> 16)) * 0x85ebca6b;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35;
  h = (h ^ (h >>> 16)) >>> 0;
  return lo + (h % (hi - lo + 1));
}

/** Pick one word as the "error word" for this sentence. Skip first/last
 *  word so the typo lands mid-stream (visually balanced). */
function pickErrorWordIdx(en: string): number {
  const tokens = tokenizeWords(en);
  if (tokens.length < 3) return -1;
  let hash = 0;
  for (const ch of en) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const candidates: number[] = [];
  for (let i = 1; i < tokens.length - 1; i++) candidates.push(i);
  if (candidates.length === 0) return -1;
  return candidates[hash % candidates.length];
}

/** Pick a "wrong" letter for a given correct char inside a word.
 *  Strategy: prefer a visually-similar look-alike from a curated map
 *  (n↔h, l↔i, m↔n, etc.); otherwise fall back to a different letter
 *  from the same word. The wrong text reads as an obvious typo
 *  ("dri*hk*" instead of "drink").
 *
 *  IMPORTANT: wrong text MUST be a single character — the slot's CSS
 *  width is sized for one character (0.625em), and any longer text
 *  would wrap onto a second line and break the inline-flow layout. */
const LOOK_ALIKES: Record<string, string> = {
  n: 'h', h: 'n',
  m: 'n',
  l: 'i', i: 'l',
  o: 'c', c: 'o',
  u: 'v', v: 'u',
  r: 't', t: 'r',
  e: 'c',
  a: 'e',
  d: 'c',
  s: 'z',
};

function pickWrongChar(correct: string, word: string): string {
  const lower = correct.toLowerCase();
  const la = LOOK_ALIKES[lower];
  if (la && la.length === 1) return la;
  for (const ch of word.toLowerCase()) {
    if (ch !== lower && /[a-z]/.test(ch) && ch.length === 1) return ch;
  }
  return 'a';
}

/** Build per-word timings. Each word resolves its `endAt` based on
 *  whether it's the error word (longer cycle: judge→flash→fade→re-type)
 *  or a normal word (single settle pass). Subsequent words' `judgeAt`
 *  starts after the previous word's `endAt`. */
function buildWordTimings(en: string, errorIdx: number, jitterSeed: number): WordMeta[] {
  const tokens = tokenizeWords(en);
  const words: WordMeta[] = [];
  let cursor = EN_BASE_DELAY;

  for (let wi = 0; wi < tokens.length; wi++) {
    const tok = tokens[wi];
    const intra = hashJitter(jitterSeed ^ (wi * 2654435761), 30, 80);

    const settleStart = cursor;
    const settleEnd = settleStart + intra * (tok.text.length - 1) + EN_SETTLE_DURATION;

    const isErrorWord = wi === errorIdx;
    const judgeAt = settleEnd + JUDGE_DELAY;
    const flashAt = isErrorWord ? judgeAt : settleEnd;
    const fadeOutAt = flashAt + FLASH_DURATION;
    const retypeAt = fadeOutAt + RETYPE_PAUSE;
    const retypeEnd = retypeAt + intra * (tok.text.length - 1) + EN_SETTLE_DURATION;

    const endAt = isErrorWord ? retypeEnd + RECOVERY_PAUSE : settleEnd;

    // 错改词:整词中**只一个字符**被替换成"看起来像"的错字 —— 跟正确版本只差一个字母,
    // 其它字符保持正确。
    //
    // e.g. "drink" 选第 3 个字符 'n' 错成 'h' → 初输显示 "drihk"(差一个字母,看着像真打错),
    //      judge 后 flash(红字 + line-through) → fade → 重输 settle 为 "drink"。
    //
    // 字符位置 = jitterSeed 派生,保证同一个句子不同 cycle 出不同位置;
    // 字符选择范围 = 跳过首尾(避免错在词首/词尾变成前缀/后缀差)。
    let wrongChars: string[] | null = null;
    let wrongCharIdx: number | null = null;
    if (isErrorWord) {
      wrongChars = Array.from(tok.text);
      const lo = tok.text.length >= 3 ? 1 : 0;
      const hi = tok.text.length >= 3 ? tok.text.length - 1 : tok.text.length;
      const seed = (jitterSeed * 31 + wi * 17) >>> 0;
      const pickK = lo + (seed % Math.max(1, hi - lo));
      const origChar = tok.text[pickK];
      wrongCharIdx = pickK;
      wrongChars[pickK] = pickWrongChar(origChar, tok.text);
    }

    words.push({
      text: tok.text,
      wrongChars,
      wrongCharIdx,
      startIdx: tok.startIdx,
      judgeAt,
      flashAt,
      fadeOutAt,
      retypeAt,
      endAt,
      isErrorWord,
    });

    cursor = endAt + hashJitter(jitterSeed ^ (wi * 2246822519 + 13), 80, 160);
  }
  return words;
}

export default function TypefallDemo() {
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);

  // Reduced-motion check (SSR-safe: 默认 false,hydrated 后再判)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const current = DEMOS[index];

  const zhChars = useMemo(() => Array.from(current.zh), [current.zh]);
  const zhTimings = useMemo(
    () => zhChars.map((_, i) => ({
      delay: ZH_BASE_DELAY + i * ZH_CHAR_STAGGER,
    })),
    [current.zh],
  );

  const errorWordIdx = useMemo(() => pickErrorWordIdx(current.en), [current.en]);

  const words = useMemo(
    () => buildWordTimings(current.en, errorWordIdx, index),
    [current.en, errorWordIdx, index],
  );

  // 全句真正"打字完成 + 错改修正完毕"的时刻
  const fullDoneMs = useMemo(
    () => words.reduce((max, w) => Math.max(max, w.endAt), 0),
    [words],
  );

  // 容器常驻 —— 内容原地替换,不淡出。
  const nextMs = fullDoneMs + DWELL_AFTER_FULL + LOOP_PAUSE;

  useEffect(() => {
    if (reduced) return;
    const tNext = window.setTimeout(() => {
      setIndex((i) => (i + 1) % DEMOS.length);
    }, nextMs);
    return () => window.clearTimeout(tNext);
  }, [index, reduced, nextMs]);

  return (
    <div
      className="typefall"
      role="presentation"
      aria-hidden
      data-reduced={reduced ? 'true' : 'false'}
      data-error-word={errorWordIdx >= 0 ? errorWordIdx : 'none'}
    >
      <p className="typefall__zh" key={`zh-${index}`}>
        {zhChars.map((ch, i) => (
          <span
            key={`zh-${index}-${i}`}
            className="typefall__zh-char"
            style={{ animationDelay: `${zhTimings[i].delay}ms` }}
          >
            {ch}
          </span>
        ))}
      </p>

      <div className="typefall__en" key={`en-${index}`}>
        {words.map((word, wi) => {
          const isError = word.isErrorWord;
          const cls = 'typefall__word' + (isError ? ' typefall__word--err' : '');
          const wordSettleStart = word.judgeAt - JUDGE_DELAY - EN_SETTLE_DURATION;
          const intraGuess = 50;
          return (
            <span
              key={`w-${index}-${wi}`}
              className={cls}
              data-error-word={isError ? 'true' : 'false'}
              style={{
                '--typefall-word-flash-at': `${word.flashAt}ms`,
                '--typefall-word-fadeout-at': `${word.fadeOutAt}ms`,
                '--typefall-word-retype-at': `${word.retypeAt}ms`,
                '--typefall-word-cycle': `${word.endAt - wordSettleStart}ms`,
                '--typefall-word-settle-start': `${wordSettleStart}ms`,
                '--typefall-word-settle-end': `${wordSettleStart + intraGuess * (word.text.length - 1) + EN_SETTLE_DURATION}ms`,
                '--typefall-word-settle-window': `${intraGuess * (word.text.length - 1) + EN_SETTLE_DURATION + 200}ms`,
              } as React.CSSProperties & Record<string, string>}
            >
              {Array.from(word.text).map((ch, k) => {
                const charSettleStart = wordSettleStart + intraGuess * k;
                const charRetypeStart = word.retypeAt + intraGuess * k;
                // 错改词里只有 wrongCharIdx 这一字符走 slot 双层动画
                // (wrong → fade → correct),其它字符走普通 .en-char 单层 settle。
                if (isError && word.wrongChars && word.wrongCharIdx === k) {
                  const wrongText = word.wrongChars[k];
                  return (
                    <span
                      key={`en-${index}-${wi}-${k}`}
                      className="typefall__en-slot"
                      style={{
                        '--typefall-settle-delay': `${charSettleStart}ms`,
                        '--typefall-retype-delay': `${charRetypeStart}ms`,
                        /* wrong 字符自己的 delay = 它所在字符的 stagger 起点,
                           让它跟其它字符一样按 stagger 顺序浮现,而不是
                           一次性跟首字符一起出。 */
                        '--typefall-wrong-delay': `${charSettleStart}ms`,
                      } as React.CSSProperties & Record<string, string>}
                    >
                      {/* 直接渲染正确字符 —— slot 自身显示正确字符作为底色,
                          wrong 字符绝对覆盖在上面 */}
                      {ch}
                      <span className="typefall__en-wrong" aria-hidden>{wrongText}</span>
                    </span>
                  );
                }
                // 错改词的其它字符(以及所有普通词):单层 .en-char,
                // 整词走 typefall-word-flash 错误效果时,这些字符也跟着
                // 一起进错改视觉(由 .typefall__word--err .typefall__en-char
                // 选择器覆盖 —— 但这里渲染的还是 .en-char class,所以选不中,
                // 错改时这些字符保持正确 settle 状态;整词 flash 阶段只是
                // 背景 + 那个错字符变红)。
                const charStyle: React.CSSProperties & Record<string, string> = {
                  '--typefall-settle-delay': `${charSettleStart}ms`,
                };
                return (
                  <span
                    key={`en-${index}-${wi}-${k}`}
                    className="typefall__en-char"
                    style={charStyle}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          );
        })}
      </div>
    </div>
  );
}
