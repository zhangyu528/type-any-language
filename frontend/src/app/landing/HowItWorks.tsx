'use client';

/**
 * HowItWorks — 02 · 三步法(听 / 写 / 改)
 *
 * 滚动进入视口时三卡 stagger 上浮(Q 弹 overshoot);
 * 鼠标悬停某张卡时,卡内的 mini demo 启动循环演示:
 *   - 听  → Waveform 开始跳动(组件本身支持 playing prop)
 *   - 写  → 4s 序列:键位高亮逐格移动 + 目标字符串逐字追加
 *   - 改  → 5s 序列:写对→写错→红笔划线→退格→重写→盖章
 *
 * 全部受 prefers-reduced-motion 守卫:开启时 Waveform 静止、
 * 写/改 demo 直接定格在第一帧,不做 setTimeout 循环。
 *
 * 点击任一卡 → 滚动到 #lib-showcase(由 LandingPage 渲染)。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import BubbleCard from '../ds/components/BubbleCard';
import Waveform from '../ds/components/Waveform';
import KeyCap from '../ds/components/KeyCap';
import TypedText, { type CharState } from '../ds/components/TypedText';
import { riseIn, staggerParent, spring } from '../ds/motion';
import styles from './HowItWorks.module.css';

interface HowItWorksProps {
  onJumpToLibs?: () => void;
}

const SECTION_ID = 'how-it-works';

/* ============================================================
 * 听 demo:Waveform playing prop
 * ============================================================ */

function ListeningDemo({ active }: { active: boolean }): ReactElement {
  return (
    <div className={styles.demoBox} aria-hidden>
      <Waveform playing={active} bars={28} />
    </div>
  );
}

/* ============================================================
 * 写 demo:键位高亮 + 目标字符串逐字追加
 * ============================================================ */

const TYPING_TARGET = 'typing demo';
const TYPING_STEP_MS = 320;

function TypingDemo({ active }: { active: boolean }): ReactElement {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || reduced) return;
    timer.current = setInterval(() => {
      setStep((s) => (s + 1) % (TYPING_TARGET.length + 4));
    }, TYPING_STEP_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, reduced]);

  // step 0..len+3: 0..len 是逐字追加, len+1..len+3 是停 3 拍
  const typed = TYPING_TARGET.slice(0, Math.min(step, TYPING_TARGET.length));
  const highlightKey =
    step < TYPING_TARGET.length
      ? TYPING_TARGET[step].toLowerCase()
      : null;

  return (
    <div className={styles.demoBox} aria-hidden>
      <div className={styles.kbRow}>
        {['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'].map((k) => (
          <KeyCap
            key={k}
            className={highlightKey === k ? styles.kbHit : undefined}
          >
            {k}
          </KeyCap>
        ))}
      </div>
      <div className={styles.kbRow}>
        {['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'].map((k) => (
          <KeyCap
            key={k}
            className={highlightKey === k ? styles.kbHit : undefined}
          >
            {k}
          </KeyCap>
        ))}
      </div>
      <div className={styles.typedLine}>
        <span className={styles.typedLabel}>type ›</span>
        <span className={styles.typedValue}>{typed || '\u00a0'}</span>
        <span className={styles.typedCaret} />
      </div>
    </div>
  );
}

/* ============================================================
 * 改 demo:状态帧序列
 * ============================================================ */

const FIX_TARGET = 'She lived in Sydney.';

interface FixFrame {
  /** 字符状态数组(长度会自动按 target 长度补齐) */
  states: CharState[];
  caret: number;
  /** 这一帧停留多久(ms) */
  hold: number;
  /** 中文 hint(可选,辅助理解) */
  hint: string;
}

// 字符填充:把所有 'untyped'/'current'/'caret 之后的位置填成 'untyped'
function padStates(target: string, partial: CharState[]): CharState[] {
  const out: CharState[] = [];
  for (let i = 0; i < target.length; i++) {
    out.push(partial[i] ?? 'untyped');
  }
  return out;
}

const FIX_FRAMES: FixFrame[] = [
  // 0: 还没开始,光标在最前
  { states: ['current'], caret: 0, hold: 280, hint: '' },
  // 1-4: 写对 "She " 4 字符
  { states: ['correct', 'current'], caret: 1, hold: 240, hint: '' },
  { states: ['correct', 'correct', 'current'], caret: 2, hold: 240, hint: '' },
  { states: ['correct', 'correct', 'correct', 'current'], caret: 3, hold: 240, hint: '' },
  // 5: 写错 'l' → state error
  {
    states: ['correct', 'correct', 'correct', 'correct', 'error'],
    caret: 5,
    hold: 240,
    hint: '',
  },
  // 6: 红笔划线持续一拍(状态不变,但更长的 hold 给眼睛时间)
  {
    states: ['correct', 'correct', 'correct', 'correct', 'error'],
    caret: 5,
    hold: 500,
    hint: '',
  },
  // 7: 退格,光标回到 4
  { states: ['correct', 'correct', 'correct', 'correct', 'current'], caret: 4, hold: 220, hint: '' },
  // 8-12: 重写 "lived "
  {
    states: ['correct', 'correct', 'correct', 'correct', 'correct', 'current'],
    caret: 5,
    hold: 220,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 6,
    hold: 220,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 7,
    hold: 220,
    hint: '',
  },
  // 9: 写完 "lived" 之后,继续 " in Sydney." 加速
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 8,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 9,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 10,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 11,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 12,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 13,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 14,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 15,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 16,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 17,
    hold: 200,
    hint: '',
  },
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'current',
    ],
    caret: 18,
    hold: 200,
    hint: '',
  },
  // settled: 全部 correct,光标消失
  {
    states: [
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
    ],
    caret: -1,
    hold: 1400,
    hint: '在悉尼生活',
  },
];

const FIX_REPLAY_PAUSE = 800;

function FixDemo({ active }: { active: boolean }): ReactElement {
  const reduced = useReducedMotion();
  const [frameIdx, setFrameIdx] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!active || reduced) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];

    let cancelled = false;
    let elapsed = 0;
    FIX_FRAMES.forEach((frame, i) => {
      const t = setTimeout(() => {
        if (!cancelled) setFrameIdx(i);
      }, elapsed);
      timers.current.push(t);
      elapsed += frame.hold;
    });
    // Replay pause, then reset
    const resetT = setTimeout(() => {
      if (!cancelled) setFrameIdx(0);
    }, elapsed + FIX_REPLAY_PAUSE);
    timers.current.push(resetT);

    return () => {
      cancelled = true;
      timers.current.forEach(clearTimeout);
    };
  }, [active, reduced]);

  const frame = FIX_FRAMES[frameIdx] ?? FIX_FRAMES[0];
  const states = padStates(FIX_TARGET, frame.states);
  const hint = frame.hint || 'She ';

  return (
    <div className={styles.demoBox} aria-hidden>
      <TypedText
        text={FIX_TARGET}
        states={states}
        caret={frame.caret >= 0 ? frame.caret : undefined}
        className={styles.fixText}
      />
      <div className={styles.fixHint}>{hint}</div>
    </div>
  );
}

/* ============================================================
 * 三步卡
 * ============================================================ */

interface StepSpec {
  badge: string;
  title: string;
  subtitle: string;
  body: string;
  Demo: (props: { active: boolean }) => ReactElement;
}

const STEPS: StepSpec[] = [
  {
    badge: '01',
    title: '听',
    subtitle: '真实语料',
    body: '一句日常英语正常语速播放,不放慢、不切碎。',
    Demo: ListeningDemo,
  },
  {
    badge: '02',
    title: '写',
    subtitle: '逐字敲击',
    body: '像打字机一样按节奏敲出,错一个字就停下。',
    Demo: TypingDemo,
  },
  {
    badge: '03',
    title: '改',
    subtitle: '即时批改',
    body: '错的字符被红笔划掉,正确的盖章通过。',
    Demo: FixDemo,
  },
];

export default function HowItWorks({ onJumpToLibs }: HowItWorksProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  return (
    <section
      id={SECTION_ID}
      className={styles.root}
      aria-labelledby="how-it-works-title"
    >
      <motion.header
        className={styles.header}
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-15% 0px' }}
      >
        <motion.p className={styles.kicker} variants={riseIn}>
          02 · 怎么练
        </motion.p>
        <motion.h2 id="how-it-works-title" className={styles.title} variants={riseIn}>
          三步,练出一句
        </motion.h2>
        <motion.p className={styles.subtitle} variants={riseIn}>
          听一句日常英语,逐字敲出来,错了红笔划掉。三个动作,没有别的。
        </motion.p>
      </motion.header>

      <motion.ol
        className={styles.steps}
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-10% 0px' }}
      >
        {STEPS.map((step, i) => {
          const isActive = activeIdx === i;
          return (
            <motion.li
              key={step.badge}
              variants={riseIn}
              transition={spring.overshoot}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() =>
                setActiveIdx((cur) => (cur === i ? null : cur))
              }
              onFocus={() => setActiveIdx(i)}
              onBlur={() =>
                setActiveIdx((cur) => (cur === i ? null : cur))
              }
            >
              <BubbleCard as="article" interactive className={styles.card}>
                <button
                  type="button"
                  className={styles.cardButton}
                  onClick={onJumpToLibs}
                  aria-label={`${step.title}:${step.body}`}
                >
                  <span className={styles.badge}>{step.badge}</span>
                  <h3 className={styles.cardTitle}>
                    {step.title}
                    <span className={styles.cardSubtitle}>
                      {' '}
                      · {step.subtitle}
                    </span>
                  </h3>
                  <step.Demo active={isActive} />
                  <p className={styles.cardBody}>{step.body}</p>
                  <span className={styles.hint}>
                    {isActive ? '▸ 演示中' : '悬停查看演示'}
                  </span>
                </button>
              </BubbleCard>
            </motion.li>
          );
        })}
      </motion.ol>
    </section>
  );
}
