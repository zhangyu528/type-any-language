'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './TypefallDemo.module.css';

/**
 * TypefallDemo — hero 区域"中→英听写"微观动作演示
 *
 * 1:1 对齐实际练习:
 *   - 中文题目直接渲染(灰色小字提示),无逐字 fade-in
 *   - 英文逐词填入,字符从模糊渐清晰到 settle
 *   - 选中的错改词:字符先错版 settle → 标朱砂 + 删除线 → 字符逐个
 *     退格(向左滑出) → 留空 → 正确字符 spring-in 替换
 *   - 修正后停顿 ~600ms,该词后面的输入再继续
 *   - 容器常驻,内容原地替换(React 用 key 切下一句)
 *
 * 节奏设计 ——「真人翻译」的微观动作:
 *   - 词内字符:30-80ms 抖动
 *   - 词间停顿:150-280ms(代表"回忆下一个词")
 *   - 错改词 settle 完成后 +360ms hold(代表"看着刚输的")
 *   - 退格 70ms/字符
 *   - 退格后 +280ms 光标闪一下("回想正确字符")
 *   - 重输 settle 与初输节奏一致(逐字符 spring-in)
 *   - 修正后停顿:RECOVERY_PAUSE = 200ms,随后该词 settle 结束,
 *     下一个词的字符才启动 settle
 */
const DEMOS: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: '我每天早上喝咖啡。', en: 'I drink coffee every morning.' },
  { zh: '你下周有什么计划？', en: 'What are your plans next week?' },
  { zh: '这个想法很有趣。', en: 'That is a really interesting idea.' },
];

// 时间线常量(ms)—— 调整这里改节奏
// 中文题目直接渲染(无逐字 fade-in),见 .zh 样式。
const EN_BASE_DELAY = 600;       // 读题停顿:zh 落定后等用户「看完中文再下笔」
const EN_CHAR_STAGGER = 150;
const EN_SETTLE_DURATION = 380;
const WRONG_HOLD = 360;            // 错字符 settle 完后,代表"看着刚输的"
const WRONG_RECOGNIZE = 320;       // 识别到错的「诶?」停顿(judgeAt → backspaceAt)
const BACKSPACE_PER_CHAR = 70;     // 退格每字符耗时
const BACKSPACE_STAGGER = 25;      // 退格字符间的级联
const CURSOR_BLINK = 80;           // 退格完成后,代表"回想正确字符"
const RETYPE_STAGGER = 150;        // 重输字符间的级联(与初次输入 EN_CHAR_STAGGER 一致)
const RETYPE_DURATION = 380;       // 重输 settle 持续
const RECOVERY_PAUSE = 200;        // 修正后停顿("反应过来")
const WORD_HOLD_TAIL = 400;        // 整词 settle 完成后下划线保持透明的尾巴时间(防止瞬态跳变)
const DWELL_AFTER_FULL = 1600;     // 整句完成后停留(用户能看清)
const LOOP_PAUSE = 320;            // 切下一句前的间隔

interface WordMeta {
  /** 词文本,如 "drink" */
  text: string;
  /** 错改词专属:整词中**只一个字符**被替换为相似形。其它字符与 text 一致。 */
  wrongChars: string[] | null;
  /** 错改词被选中的字符 idx(0-based)。非错改词为 null。 */
  wrongCharIdx: number | null;
  /** 当前词的 settle 起始时刻(基于上一个词的 endAt + 词间停顿算出) */
  startSettleAt: number;
  /** 整词最后一个字符 settle 完成的时刻(下划线由 --ds-ink 切到 transparent、字符颜色切到 mint-deep 的时刻) */
  settleEnd: number;
  /** "判断时刻" = 该词最后字符 settle 完成 + WRONG_HOLD */
  judgeAt: number;
  /** "退格阶段开始" = judgeAt */
  backspaceAt: number;
  /** 整词最后一个字符退格完成的时刻 */
  backspaceDoneAt: number;
  /** "重输正确 settle 开始" = backspaceDoneAt + CURSOR_BLINK */
  retypeAt: number;
  /** "重输 settle 完成" = retypeAt + RETYPE_STAGGER × (len-1) + RETYPE_DURATION */
  retypeEndAt: number;
  /** "最终落定完成" = retypeEnd + RECOVERY_PAUSE */
  endAt: number;
  /** 是否为错改演示词 */
  isErrorWord: boolean;
}

function tokenizeWords(en: string): { text: string; startIdx: number }[] {
  const out: { text: string; startIdx: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(en)) !== null) {
    out.push({ text: m[0], startIdx: m.index });
  }
  return out;
}

function hashJitter(seed: number, lo: number, hi: number): number {
  let h = seed >>> 0;
  h = (h ^ (h >>> 16)) * 0x85ebca6b;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35;
  h = (h ^ (h >>> 16)) >>> 0;
  return lo + (h % (hi - lo + 1));
}

/** Pick one word as the "error word" for this sentence. Skip first/last
 *  word so the typo lands mid-stream. */
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

/** Pick a "wrong" letter for a given correct char. Prefer visually-similar
 *  look-alikes (n↔h, l↔i, m↔n); fall back to a different letter from the
 *  same word. Single character — slot width is sized for one. */
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

function buildWordTimings(en: string, errorIdx: number, jitterSeed: number): WordMeta[] {
  const tokens = tokenizeWords(en);
  const words: WordMeta[] = [];
  let cursor = EN_BASE_DELAY;

  for (let wi = 0; wi < tokens.length; wi++) {
    const tok = tokens[wi];

    const startSettleAt = cursor;
    /* 用固定 EN_CHAR_STAGGER 算 settleEnd —— 字符 settle 启动间隔是固定值,
       下划线切色点必须严格对齐"最后一个字符 settle 完成"那一刻。
       如果这里用 jittered intra(30-80ms),而字符 settle 用 120ms,会导致
       intra 偏小时 keyframe 切色点比字符实际 settle 完早 100-300ms,
       视觉上"单词还没输完下划线就变绿"。
       词间停顿仍走 jitter(150-280ms),保持节奏呼吸感。 */
    const settleEnd =
      cursor + EN_CHAR_STAGGER * (tok.text.length - 1) + EN_SETTLE_DURATION;
    const isErrorWord = wi === errorIdx;

    const judgeAt = settleEnd + WRONG_HOLD;
    // 退格比 judgeAt 晚 320ms ——「诶?打错了」的识别瞬间(中等停顿,够用户
    // 看清朱砂下划线 + 字符删除线,但不至于慢到让节奏拖沓)
    const backspaceAt = judgeAt + (isErrorWord ? WRONG_RECOGNIZE : 0);
    const lastCharBackspaceStart = backspaceAt + BACKSPACE_STAGGER * (tok.text.length - 1);
    const backspaceDoneAt = lastCharBackspaceStart + BACKSPACE_PER_CHAR;
    const retypeAt = backspaceDoneAt + CURSOR_BLINK;
    const retypeEndAt = retypeAt + RETYPE_STAGGER * (tok.text.length - 1) + RETYPE_DURATION;

    const endAt = isErrorWord ? retypeEndAt + RECOVERY_PAUSE : settleEnd;

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
      startSettleAt,
      settleEnd,
      judgeAt,
      backspaceAt,
      backspaceDoneAt,
      retypeAt,
      retypeEndAt,
      endAt,
      isErrorWord,
    });

    cursor = endAt + hashJitter(jitterSeed ^ (wi * 2246822519 + 13), 150, 280);
  }
  return words;
}

export default function TypefallDemo() {
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const current = DEMOS[index];

  const errorWordIdx = useMemo(() => pickErrorWordIdx(current.en), [current.en]);

  const words = useMemo(
    () => buildWordTimings(current.en, errorWordIdx, index),
    [current.en, errorWordIdx, index],
  );

  const fullDoneMs = useMemo(
    () => words.reduce((max, w) => Math.max(max, w.endAt), 0),
    [words],
  );

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
      className={styles.root}
      role="presentation"
      aria-hidden
      data-reduced={reduced ? 'true' : 'false'}
      data-error-word={errorWordIdx >= 0 ? errorWordIdx : 'none'}
    >
      <p className={styles.zh} key={`zh-${index}`}>
        {current.zh}
      </p>

      <div className={styles.enRow}>
        <p className={styles.en} key={`en-${index}`}>
          {words.map((word, wi) => {
            const isError = word.isErrorWord;
            const wordClass = isError
              ? `${styles.word} ${styles.wordErr}`
              : styles.word;

            /* 每词独一无二的 keyframe —— 名字按 index+wi 拼,
               保证 SSR / 切句 / 热重载 时 keyframe 不撞车。
               下划线跟"整词"状态同步:
                 - 正常词:整词 settleEnd 切到 transparent(下划线消失),
                   character color 切到 mint-deep(由 .word 继承,
                   整词同步变绿),之后维持 WORD_HOLD_TAIL
                 - 错改词:judgeAt(整词 settle + WRONG_HOLD = "看着刚输错")切到
                   朱砂,retypeEndAt(整词重输 settle 完)切到 transparent
                   (下划线消失,字符色保持 mint-deep)
               animation-delay = startSettleAt —— 让 keyframe 在该词字符
               settle 真正开始时启动(关键!否则所有 keyframe 在 mount 0ms
               同时跑,跨词时序全错)。
               既然有 delay,keyframe 内的百分比必须是相对 delay 的:
               pMintOn = (settleEnd - startSettleAt) / ruleTotal,
                 即"该词字符 settle 持续时间"占 keyframe 总长的比例。
               0% 起色必须与 .word 默认 border-bottom-color 完全一致,
               否则 mount 时会出现瞬态跳变。 */
            const ruleAnimName = `kf-rule-${index}-${wi}`;
            // 起始色 = var(--ds-ink),与该时间窗下字符 inherit 的 color
            // 同源 —— 输入过程中下划线跟字符同色,看上去是"笔尖正在描的线"。
            // 注意:这跟 .word 静态 border-bottom-color (22% 灰透明)
            // 不一样 —— 静态色是 placeholder 阶段(该词 keyframe 还没启动),
            // 跟 practice 页 .cell 占位下划线一致。两个颜色对应两个状态。
            const ruleStartColor = 'var(--ds-ink)';
            const ruleDelay = `${word.startSettleAt}ms`;
            let ruleKeyframes: string;
            let ruleDur: string;
            if (isError) {
              const relErrDur = word.endAt - word.startSettleAt;
              ruleDur = `${relErrDur}ms`;
              const pAccentOn = ((word.judgeAt - word.startSettleAt) / relErrDur) * 100;
              /* 退格完成 = backspaceDoneAt,字符已全部滑出,代表"字空了"。
                 此时下划线切回 ink(--ds-ink,与原字符色同,作为重输占位),
                 然后等 retypeEndAt(正确字符 fade-in 完成)切到 transparent
                 —— 与 practice .cellCorrect::after opacity:0 一致。 */
              const pAccentOff = ((word.backspaceDoneAt - word.startSettleAt) / relErrDur) * 100;
              const pMintOn = ((word.retypeEndAt - word.startSettleAt) / relErrDur) * 100;
              /* step 写法:每个色块前留 0.01% 锁住前色,避免 CSS 自动
                 线性插值导致「过程就开始渐变」。 */
              const pBeforeAccent = Math.max(0, pAccentOn - 0.01);
              const pBeforeBack = Math.max(0, pAccentOff - 0.01);
              const pBeforeMint = Math.max(0, pMintOn - 0.01);
              /* 错误→重输 settle 完成时,下划线应该彻底消失(透明),
                 与 practice 页 .cellCorrect::after opacity:0 一致 —
                 字符颜色(--ds-action-deep)由 .enCharOk 接管,继续承担
                 "输入正确"的视觉提示;下划线本身失去意义。 */
              ruleKeyframes =
                `@keyframes ${ruleAnimName}{` +
                `0%{border-bottom-color:${ruleStartColor};}` +
                `${pBeforeAccent.toFixed(2)}%{border-bottom-color:${ruleStartColor};}` +
                `${pAccentOn.toFixed(2)}%{border-bottom-color:var(--ds-error);}` +
                `${pBeforeBack.toFixed(2)}%{border-bottom-color:var(--ds-error);}` +
                `${pAccentOff.toFixed(2)}%{border-bottom-color:${ruleStartColor};}` +
                `${pBeforeMint.toFixed(2)}%{border-bottom-color:${ruleStartColor};}` +
                `${pMintOn.toFixed(2)}%{border-bottom-color:transparent;}` +
                `100%{border-bottom-color:transparent;}` +
                `}`;
            } else {
              const relSettleDur = word.settleEnd - word.startSettleAt;
              const ruleTotal = relSettleDur + WORD_HOLD_TAIL;
              ruleDur = `${ruleTotal}ms`;
              const pMintOn = (relSettleDur / ruleTotal) * 100;
              /* 整词同步切色:border-bottom 切到 transparent(下划线
                 消失 —— 与 practice 页 .cellCorrect::after 一致),
                 character color(--ds-action-deep)由 .enChar fade-in 后
                 的 stable state 接管,继续承担"输入正确"的视觉提示。
                 关键:必须用 step 写法 —— 在 pMintOn 前一帧锁住前色,
                 否则 CSS 会在 0% → pMintOn 之间自动线性插值,视觉上
                 「字符刚开始 settle 下划线就在渐变」。step 让切色严格
                 发生在最后一个字符 100% 完成那一刻。 */
              const pStepBefore = Math.max(0, pMintOn - 0.01);
              ruleKeyframes =
                `@keyframes ${ruleAnimName}{` +
                `0%{border-bottom-color:${ruleStartColor};color:var(--ds-ink);}` +
                `${pStepBefore.toFixed(2)}%{border-bottom-color:${ruleStartColor};color:var(--ds-ink);}` +
                `${pMintOn.toFixed(2)}%{border-bottom-color:transparent;color:var(--ds-action-deep);}` +
                `100%{border-bottom-color:transparent;color:var(--ds-action-deep);}` +
                `}`;
            }

            return (
              <span
                key={`w-${index}-${wi}`}
                style={{ display: 'contents' }}
              >
                {/* Per-word keyframe:每个词挂一份独一无二的 <style> 标签,
                   keyframe 名字按 index+wi 拼。React 会在词 unmount 时把
                   <style> 也一起清掉,不会跨句泄漏。 */}
                <style>{ruleKeyframes}</style>
                <span
                  className={wordClass}
                  style={{
                    animation: `${ruleAnimName} ${ruleDur} ${ruleDelay} linear forwards`,
                    '--typefall-word-blink-at': `${word.backspaceAt + BACKSPACE_PER_CHAR * (word.text.length - 1) + CURSOR_BLINK}ms`,
                    '--typefall-word-wrong-at': `${word.backspaceAt}ms`,
                    /* 退格光标:在 backspaceAt 出现,retypeAt 前 20ms 消失,
                       模拟「手指在键上按退格」的小竖线 */
                    '--typefall-word-cursor-on': `${word.backspaceAt}ms`,
                    '--typefall-word-cursor-off': `${word.retypeAt - 20}ms`,
                  } as React.CSSProperties & Record<string, string>}
                >
                {Array.from(word.text).map((ch, k) => {
                  // 字符 settle 起始用 word meta 的 startSettleAt(基于上一
                  // 词的 endAt 算出),保证严格串行:错改词修正完成前,
                  // 下一个词的字符不会启动 settle。
                  const charSettleStart =
                    word.startSettleAt + k * EN_CHAR_STAGGER;
                  const charBackspaceStart =
                    word.backspaceAt + k * BACKSPACE_STAGGER;
                  const charRetypeStart =
                    word.retypeAt + k * RETYPE_STAGGER;

                  const baseStyle: React.CSSProperties & Record<string, string> = {
                    '--typefall-settle-delay': `${charSettleStart}ms`,
                    '--typefall-backspace-delay': `${charBackspaceStart}ms`,
                    '--typefall-backspace-duration': `${BACKSPACE_PER_CHAR}ms`,
                    '--typefall-retype-delay': `${charRetypeStart}ms`,
                  };

                  if (isError) {
                    /* 错改词:同时渲染错字符 + 对字符 两个 span,靠 CSS
                       控制可见性时窗。
                         - .enCharErr 跑完整 typefallEnErrChain(settle → 错 → 退格)
                         - .enCharOk 在 retypeAt + k*45ms fade-in
                       渲染前错字符 fade-out 的视觉空档由对字符 fade-in 填补,
                       无缝衔接。不再需要 React 状态切换。 */
                    const showChar =
                      word.wrongChars && word.wrongCharIdx === k
                        ? word.wrongChars[k]
                        : ch;
                    return (
                      <span key={`en-${index}-${wi}-${k}`} className={styles.enCharWrap}>
                        <span className={styles.enCharErr} style={baseStyle}>
                          {showChar}
                        </span>
                        <span className={styles.enCharOk} style={baseStyle}>
                          {ch}
                        </span>
                      </span>
                    );
                  }

                  // Normal word: single settle, no correction.
                  return (
                    <span
                      key={`en-${index}-${wi}-${k}`}
                      className={styles.enChar}
                      style={baseStyle}
                    >
                      {ch}
                    </span>
                  );
                })}
                </span>
              </span>
            );
          })}
        </p>
      </div>
    </div>
  );
}