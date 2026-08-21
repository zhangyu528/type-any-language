'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  getAudioUrl,
  LessonSentence,
  readPrefAudioRate,
  readPrefBool,
  writePrefBool,
  STORAGE_SHOW_PHONETIC,
  WordInLesson,
} from './api';
import SunkenShortcutBar from './SunkenShortcutBar';
import SpecularButton from '@/components/SpecularButton';
import BorderGlow from '@/components/BorderGlow';
import IconButton from './ds/components/IconButton';
import Button from './ds/components/Button';
import styles from './practice/TranslationStage.module.css';

interface TranslationStageProps {
  /** The sentence being practiced — `chinese_text` is the prompt (what
   *  the user sees), `text` is the English reference shown after a
   *  wrong answer. */
  sentence: LessonSentence;
  /** Target word for the word-card at the top of the stage. */
  targetWord: WordInLesson;
  /** Called when the user finishes a step. `correct` is true on a clean
   *  check, false on "skip". */
  onComplete: (correct: boolean) => void;
}

/**
 * TranslationStage — single step of the standalone ZH→EN drill.
 *
 * UX:
 *   - Top: word card (word + phonetic + Chinese translation)
 *   - Caption: "看中文写英文"
 *   - Middle: Chinese prompt (large)
 *   - Below: per-word cell row — each English word in the answer is
 *     rendered as an underscore cell that fills as the user types.
 *     Auto-advances on the last correct char; the whole word flips to
 *     sage green when finished.
 *   - Below cells: shortcut bar + skip button
 *
 * On last cell correct: 300ms chime + onComplete(true).
 * On wrong typed char: per-char red + cell shake.
 * On skip: onComplete(false).
 *
 * Audio is MANUAL only — no autoplay. User clicks 🔊 or presses Space
 * (when focus is outside any cell) to play the English sentence audio.
 *
 * Step number / progress dots are owned by the parent (the parent
 * drives a stateless, randomised step pipeline). This component is
 * the rendering of a single (word, sentence) pair.
 */
export default function TranslationStage({
  sentence,
  targetWord,
  onComplete,
}: TranslationStageProps) {
  const expectedWords = sentence.text.split(/\s+/);

  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<boolean[]>([]);
  const [wordConfirmed, setWordConfirmed] = useState<boolean[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isPeeking, setIsPeeking] = useState(false);
  // Track which shortcut keys the user is holding down so the matching
  // kbd badges in the shortcut bar light up. Strings are normalized
  // (lowercase) — see SunkenShortcutBar's matching logic.
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  // User-driven audio playback rate (from /me SettingsTab). Read
  // once on mount and refreshed whenever prefs.audioRate changes
  // (cross-tab storage event). Applied to the <audio> via
  // .playbackRate right before play(), and updated mid-playback
  // when the user changes the setting on the /me page.
  const [audioRate, setAudioRate] = useState(1);
  // Whether to render the phonetic transcription under the target
  // word. Defaults to true (Stage always showed it) but the user
  // can switch it off via /me SettingsTab.
  const [showPhonetic, setShowPhonetic] = useState(true);
  // Whether to auto-play the English audio when a new sentence loads.
  // Defaults to true (matches the "听音写句" premise); the toggle lives in
  // the shortcut bar and persists to prefs.autoPlay.
  const [autoPlayOn, setAutoPlayOn] = useState(true);
  // Page-level correct/wrong wash — a brief full-bleed tint that confirms
  // the outcome of a step without needing a modal. Auto-clears after ~900ms.
  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong'>(null);
  // Screen-reader announcement for step outcomes. The visible feedback
  // wash is aria-hidden, so this region is its accessible equivalent.
  // The wrong-answer case is announced by the .answer panel's own
  // aria-live, so we only drive this region for correct / reset.
  const [announce, setAnnounce] = useState('');
  const feedbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Per-cell overflow flash — set when the user tries to type past
  // expected.length. The cellInput picks up .cellOverflow class for
  // ~350ms and the wrong buzz fires as audible feedback.
  const overflowTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [overflowIndex, setOverflowIndex] = useState<number | null>(null);
  // Review screen — flips to true on a correct (or skipped) final cell.
  // After a correct answer we celebrate (300ms chime + mint wash) then
  // swap the drill surface for a static review surface and wait for
  // Enter to advance. Skip reveals the correct answer (graded wrong).
  const [reviewKind, setReviewKind] = useState<'correct' | 'skip' | null>(null);
  const showReview = reviewKind !== null;
  const flashFeedback = useCallback((kind: 'correct' | 'wrong') => {
    setFeedback(kind);
    if (kind === 'correct') setAnnounce('答对了');
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 900);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Last keyboard-tick timestamp — debounce key-repeat so a held key
  // doesn't fire a buzz of ticks. Set inside playKeyboardTick (below).
  const lastTickRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Mirror the latest typing state into a ref so global/keyboard handlers
  // (and cell-nav) can grade the active cell without stale closures.
  const stateRef = useRef({
    userInputs,
    wordResults,
    currentWordIndex,
    wordConfirmed,
  });
  stateRef.current = { userInputs, wordResults, currentWordIndex, wordConfirmed };

  // Continue from the review screen → hand control back to the parent.
  // Clears showReview first so the next sentence's reset effect sees
  // a clean state, then calls onComplete(true) to swap the sentence.
  const handleContinue = useCallback(() => {
    setReviewKind(null);
    onComplete(reviewKind === 'correct');
  }, [onComplete, reviewKind]);

  // Skip — reveal the correct sentence in the review screen, then let the
  // user press Enter (or click 继续) to advance. The answer is graded as
  // wrong (onComplete(false)) so the sentence re-enters the wrong bucket
  // and gets retried later, but the learner still sees the correct answer.
  const handleSkip = useCallback(() => {
    if (reviewKind !== null) return;
    setReviewKind('skip');
  }, [reviewKind]);

  // Per-sentence reset on mount or sentence change.
  useEffect(() => {
    if (overflowTimerRef.current) {
      clearTimeout(overflowTimerRef.current);
      overflowTimerRef.current = null;
    }
    setOverflowIndex(null);
    setReviewKind(null);
    setUserInputs(new Array(expectedWords.length).fill(''));
    setWordResults(new Array(expectedWords.length).fill(false));
    setWordConfirmed(new Array(expectedWords.length).fill(false));
    setCurrentWordIndex(0);
    setFeedback(null);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    if (compositionTimerRef.current) {
      clearTimeout(compositionTimerRef.current);
      compositionTimerRef.current = null;
    }
    isComposingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.id]);

  // Focus the hidden typewriter input on mount / step change.
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [sentence.id]);

  // Auto-play the English audio on each new sentence when enabled. The
  // 180ms delay lets the typewriter refocus first. Browsers may block
  // autoplay without a prior gesture — that just means play() rejects
  // silently and the user falls back to the 🔊 button.
  useEffect(() => {
    if (!autoPlayOn || !sentence.audio_url) return;
    const t = window.setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.src = getAudioUrl(sentence.audio_url);
        audioRef.current.currentTime = 0;
        audioRef.current.playbackRate = audioRate;
        audioRef.current.play().catch(() => { /* 静默 */ });
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [sentence.id, autoPlayOn, sentence.audio_url, audioRate]);

  // Read user-driven prefs on mount + subscribe to changes.
  // - audioRate: Stage applies it on every play() and updates mid-playback
  // - showPhonetic: controls whether the IPA transcription is rendered
  // Same-tab updates come from /me's storage event; cross-tab too.
  useEffect(() => {
    setAudioRate(readPrefAudioRate());
    setShowPhonetic(readPrefBool(STORAGE_SHOW_PHONETIC, true));
    setAutoPlayOn(readPrefBool('prefs.autoPlay', true));
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'prefs.audioRate') {
        setAudioRate(readPrefAudioRate());
      } else if (e.key === 'prefs.showPhonetic') {
        setShowPhonetic(readPrefBool(STORAGE_SHOW_PHONETIC, true));
      } else if (e.key === 'prefs.autoPlay') {
        setAutoPlayOn(readPrefBool('prefs.autoPlay', true));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Refocus the typewriter if a stray click lands somewhere outside
  // editable surfaces — same pattern DictationStage used. Without this,
  // stopPropagation'd button clicks can leave focus stranded and
  // subsequent keypresses won't reach the cells.
  useEffect(() => {
    const refocus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Typewriter input owns its own focus — never steal it. See the
      // note in `isEditableTarget` above for why we match by data-attr
      // instead of class name.
      if (target.closest('input[data-typewriter="true"]')) return;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      if (target.closest('[role="menu"], [role="listbox"]')) return;
      inputRef.current?.focus();
    };
    document.addEventListener('click', refocus, true);
    return () => document.removeEventListener('click', refocus, true);
  }, []);

  const playAudio = useCallback(() => {
    if (!sentence.audio_url) return;
    try {
      if (audioRef.current) {
        audioRef.current.src = getAudioUrl(sentence.audio_url);
        audioRef.current.currentTime = 0;
        // Apply the user's audioRate preference. Setting
        // playbackRate on the audio element controls rate without
        // pitch-shift (HTMLAudioElement honors this in modern
        // browsers). Changes from /me settings take effect on the
        // very next space-bar press.
        audioRef.current.playbackRate = audioRate;
        audioRef.current.play().catch(() => { /* 静默 */ });
      }
    } catch {
      /* 静默 */
    }
  }, [sentence.audio_url, audioRate]);

  // Skip reveals the correct answer first (so the user learns from the
  // miss); a second tap on "继续" advances to the next step.
  // (Tab + Shift+Tab are the only navigation keys; on-screen arrows
  // are gone — the keyboard path is the single source of truth.)

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayOn((prev) => {
      const next = !prev;
      writePrefBool('prefs.autoPlay', next);
      return next;
    });
  }, []);

  const playCorrectChime = useCallback(() => {
    try {
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [659.25, 783.99, 1046.5]; // E5, G5, C6
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.25;
      masterGain.connect(ctx.destination);

      const now = ctx.currentTime;
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = now + i * 0.09;
        const stop = start + 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, stop);
        osc.connect(gain).connect(masterGain);
        osc.start(start);
        osc.stop(stop);
      });
    } catch {
      /* 静默 */
    }
  }, []);

  const playWrongBuzz = useCallback(() => {
    try {
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      // Quick downward "buzz" — clearly distinct from the correct chime.
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    } catch {
      /* 静默 */
    }
  }, []);

  // Per-cell overflow feedback — fired when the user presses a key
  // while input.length has already reached expected.length. The cell
  // ignores the key (HTML maxLength is the source of truth, this is
  // just the audible + visual cue). 350ms is enough for the shake to
  // land without feeling laggy.
  const flashCellOverflow = useCallback(() => {
    setOverflowIndex(currentWordIndex);
    playWrongBuzz();
    if (overflowTimerRef.current) clearTimeout(overflowTimerRef.current);
    overflowTimerRef.current = setTimeout(() => setOverflowIndex(null), 350);
  }, [currentWordIndex, playWrongBuzz]);

  // Subtle typewriter click — fires on every non-modifier keypress in
  // the hidden input so the user gets a mechanical "the key was
  // received" cue. Debounced at 30ms so key-repeat (holding a key) is
  // a quiet blur instead of a staccato buzz.
  const playKeyboardTick = useCallback(() => {
    try {
      const stamp = performance.now();
      if (stamp - lastTickRef.current < 30) return;
      lastTickRef.current = stamp;
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1100;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    } catch {
      /* 静默 */
    }
  }, []);

  // ---- Cell typing ----
  // 整句思考模式:用户键入字符只更新 userInputs / 清 stale 红,**不**判
  // 对错、不染色、不自动进入 review。Enter 才会触发整句判定
  // (handleSentenceSubmit 下方)。
  // 防御性截断:value 超过 expected.length(粘贴超长/IME 绕过
  // maxLength) → 截断到 maxLength + flashCellOverflow 报错反馈。
  // maxLength 正常键入会阻止输入,但粘贴/IME 仍可能绕过。
  const handleWordChange = (index: number, value: string) => {
    if (isComposingRef.current) {
      return;
    }

    const expected = expectedWords[index];
    let safeValue = value;
    if (expected && value.length > expected.length) {
      safeValue = value.slice(0, expected.length);
      flashCellOverflow();
    }

    const newInputs = [...userInputs];
    newInputs[index] = safeValue;
    setUserInputs(newInputs);

    // Stale-red reset: user 在被标错的 cell 里重新打字 — 清掉 cellWrong
    // 类,保留 wordResults 占位(下次 submit 时被覆写)。这样修改时
    // 视觉立刻回到中性,而不是红字 + 输入字符同时存在。
    if (wordConfirmed[index]) {
      setWordConfirmed((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        next[index] = false;
        return next;
      });
    }
  };

  // Smart cell navigation target — 跳过「已确认对」的 cell
  // (wordResults[i]=true && wordConfirmed[i]=true),落到任何「不一致」
  // cell(错的、空的、曾对但被用户重新编辑使 confirmed 清零的)。
  // 读 stateRef.current 而非 useState 闭包:确保 submit 后立即按
  // Space/Backspace 智能跳时拿到的是最新 wordResults/wordConfirmed
  // (避免 useCallback 重建 + useEffect 重建 listener 的时序差)。
  // deps 只含 expectedWords(基本不变),smartNextIndex 引用稳定,Space/
  // Backspace handler 不需要随每次 submit 重建。
  // 边缘 case:句子大多数 cell 已对,只有 from 自身或某个 cell 是错/空,
  // 扫 len 圈时 step=len 才回到 from 自身(其他都扫过);若 from 自己
  // 不是已对,落到 from 自身(用户当前 cell 就是要改的 cell,合理停留/跳到
  // 自身)。fallback 仍为 0 / len-1(全对时跳回头/尾供用户从头审视)。
  const smartNextIndex = useCallback(
    (from: number, direction: 1 | -1): number => {
      if (expectedWords.length === 0) return 0;
      const len = expectedWords.length;
      const { wordResults, wordConfirmed } = stateRef.current;
      for (let step = 1; step <= len; step++) {
        const i = ((from + direction * step) % len + len) % len;
        if (i === from) {
          // 扫完 len 圈回到 from 自身;若 from 不是已对,落到自身。
          if (!(wordResults[i] && wordConfirmed[i])) return i;
          continue;
        }
        if (!(wordResults[i] && wordConfirmed[i])) return i;
      }
      return direction === 1 ? 0 : len - 1;
    },
    [expectedWords],
  );

  // 整句 submit — 一次性判定所有 cell,根据结果分流:
  //   - 整句全对 → 300ms chime + 弹 review 卡 "答对了"(整句完成反馈)
  //   - 当前 cell 答对但整句还有错/空 cell → 智能跳下一格,保持答题心流
  //   - 当前 cell 答错 → 错的 cell 标红 + 错误音效,用户原地修改再按 Enter
  //     重交(或在错的 cell 重新输入字符,输满自动重交)
  //   - 任意 cell 错但当前 cell 对:见上,跳下一格
  // Esc 任意时刻强制 skip → reviewKind='skip'。
  // 不在 reactive render 路径,纯 callback。
  const handleSentenceSubmit = useCallback(() => {
    if (isComposingRef.current) return;
    if (showReview) return; // review 卡已独占 Enter

    const results: boolean[] = [];
    const confirmed: boolean[] = [];
    let allCorrect = true;
    for (let i = 0; i < expectedWords.length; i++) {
      const expectedWord = expectedWords[i];
      const userWord = (userInputs[i] ?? '').trim();
      // 复用原 normalize: lowercase + 去标点。
      const expectedNorm = expectedWord.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const inputNorm = userWord.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const correct = userWord.length > 0 && expectedNorm === inputNorm;
      results.push(correct);
      confirmed.push(true);
      if (!correct) allCorrect = false;
    }
    setWordResults(results);
    setWordConfirmed(confirmed);

    if (allCorrect) {
      flashFeedback('correct');
      playCorrectChime();
      window.setTimeout(() => setReviewKind('correct'), 300);
    } else if (results[currentWordIndex]) {
      // 当前 cell 答对但整句还有错/空 cell → 自动跳下一格,保持心流。
      // 智能跳:用本地计算的 results 数组(而非 stateRef.wordResults)
      // 判定跳过「这次 submit 验证对」的 cell,落到错/空 cell。
      // 为什么不用 smartNextIndex:React setState 是异步的,submit 同步返回
      // 后 commit 之前 stateRef 仍是旧值,smartNextIndex 看到旧 wordResults
      // 会把刚验证为对的 cell 误判为"未对"(stale state)。
      flashFeedback('correct');
      playCorrectChime();
      const len = expectedWords.length;
      let target = (currentWordIndex + 1) % len;
      for (let step = 1; step <= len; step++) {
        const i = (currentWordIndex + step) % len;
        if (i === currentWordIndex) continue;
        if (!results[i]) {
          target = i;
          break;
        }
      }
      setCurrentWordIndex(target);
    } else {
      flashFeedback('wrong');
      playWrongBuzz();
      // 不调用 onComplete — 用户留在 step 改错再交。
    }
  }, [
    expectedWords,
    userInputs,
    currentWordIndex,
    showReview,
    flashFeedback,
    playCorrectChime,
    playWrongBuzz,
    smartNextIndex,
  ]);

  // Typewriter onKeyDown: IME housekeeping + per-word overflow guard
  // (HTML maxLength is the source of truth, this layer adds the
  // audible/visual feedback when the user runs into the wall) +
  // preventDefault for the keys the global handler also catches.
  const handleTypewriterKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (isComposingRef.current) {
      isComposingRef.current = false;
      if (compositionTimerRef.current) {
        clearTimeout(compositionTimerRef.current);
        compositionTimerRef.current = null;
      }
    }
    // Per-word overflow guard. Only fires for printable single chars
    // (length === 1) — navigation/peek keys and modifiers are exempt
    // so they don't trigger the flash. The "I'm at the cap" dedup only
    // fires when input.length has already reached expected.length, so
    // the actual letter that fills the slot still goes through.
    if (
      e.key.length === 1 &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      e.key !== ' ' && e.key !== '/'
    ) {
      const expected = expectedWords[currentWordIndex];
      const maxLen = expected?.length || 0;
      const curLen = (userInputs[currentWordIndex] || '').length;
      if (maxLen > 0 && curLen >= maxLen) {
        e.preventDefault();
        flashCellOverflow();
        return;
      }
    }
    // Typewriter click for any key that's actually letter input. Skip
    // navigation/peek keys (Tab, Space, /) and bare modifier presses
    // so the click bias maps to "I typed something" rather than "I
    // navigated". Held keys are debounced inside playKeyboardTick.
    if (
      e.key !== 'Shift' &&
      e.key !== 'Control' &&
      e.key !== 'Alt' &&
      e.key !== 'Meta' &&
      e.key !== 'Enter' &&
      e.key !== ' ' &&
      e.key !== 'k' && e.key !== 'K'
    ) {
      playKeyboardTick();
    }
    // Enter — 整句提交触发器。review 卡已用 Enter 推进,所以在 showReview
    // 时由 review 内部 handler 接管;这里的早出避免重复触发。
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSentenceSubmit();
      return;
    }
    if (e.key === ' ' || e.key === '/') {
      e.preventDefault();
    }
  };

  // Global keyboard handler — Space (next cell), Backspace (prev cell when
  // empty / native delete otherwise), K (play audio), / (peek the
  // active cell's answer), Enter (sentence submit), Esc (skip).
  // Shift+Space is intentionally omitted — Chinese IMEs hijack it for
  // 中文/英文 toggle.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      // The hidden typewriter input is intentionally focusable — it owns
      // per-word typing — and its CSS-module class name is hashed
      // (`.typewriterInput` → `TranslationStage_typewriterInput__…`), so
      // the `:not(.typewriter-input)` selector doesn't match. We mark
      // it with `data-typewriter="true"` and short-circuit here. Without
      // this, the global handler bailed out for the very input we
      // designed to capture keystrokes, which silently disabled Tab and
      // `/` (and Space→audio) on the drill.
      if (el.matches('input[type="text"][data-typewriter="true"]')) return false;
      return !!el.closest(
        'input, textarea, [contenteditable="true"]'
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      // Skip (Escape) — only from the live drill, not the review screen
      // (review owns Enter/Space already). Reveals the answer, then the
      // review screen's continue affordance advances (graded wrong).
      if (e.key === 'Escape' && !showReview) {
        e.preventDefault();
        handleSkip();
        return;
      }

      // Review screen is the only surface where Enter is a global
      // shortcut — it advances to the next sentence. We also swallow
      // Space / Tab / Backspace / '/' so leftover drill bindings don't
      // fight the review-only state (Space would otherwise trigger
      // audio, Tab would try to cycle cells, etc.).
      if (showReview) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Space') {
          e.preventDefault();
          handleContinue();
          return;
        }
        return;
      }

      // Mark this key as held — lights up the matching kbd badge in
      // the shortcut bar. Done BEFORE any key-specific handler so every
      // tracked key (Backspace / Space / K / Enter / '/') gets feedback
      // regardless of which branch executes next. Shift+Space is
      // intentionally NOT tracked — Chinese IMEs (微软拼音 / 搜狗)
      // hijack Shift+Space to toggle 中文/英文.
      const trackedKey =
        e.key === ' ' || e.code === 'Space'
            ? 'space'
            : e.key === 'Backspace'
              ? 'backspace'
              : e.key === '/'
                ? '/'
                : e.key === 'k' || e.key === 'K'
                  ? 'k'
                  : e.key === 'Enter'
                    ? 'enter'
                    : null;
      if (trackedKey) {
        setActiveKeys((prev) => (prev.includes(trackedKey) ? prev : [...prev, trackedKey]));
      }

      // Backspace — cell 有字符时浏览器默认删字符(保留打字肌肉记忆);
      // cell 已空 → 智能反向跳:跳过「已确认对」的 cell (wordResults &&
      // wordConfirmed),落到最近的错/空/未确认 cell。从 currentWordIndex
      // 起反向扫 len 圈,跳过自身(currentWordIndex),找最近的落点;找不到
      // 落点时 fallback 到 currentWordIndex - 1(字面意义的"上一格",
      // 可能是已对 cell)。
      // 读 stateRef 而非 useState 闭包:确保 submit 后立即按 Backspace
      // 也能拿到最新 wordResults/wordConfirmed/currentWordIndex。
      if (e.key === 'Backspace') {
        const { currentWordIndex: curIdx, wordResults, wordConfirmed } = stateRef.current;
        const cur = (stateRef.current.userInputs[curIdx]) || '';
        if (cur === '' && curIdx > 0) {
          e.preventDefault();
          const len = expectedWords.length;
          // 智能反向跳:跳过已对 cell,落到最近的错/空 cell;扫到自身时
          // 判别自身(curIdx),若自身是唯一没验证的 cell,跳到自身(停留)。
          let target = curIdx - 1;
          for (let step = 1; step <= len; step++) {
            const i = (curIdx - step + len * 2) % len;
            if (i === curIdx) {
              if (!(wordResults[i] && wordConfirmed[i])) {
                target = i;
                break;
              }
              continue;
            }
            if (!(wordResults[i] && wordConfirmed[i])) {
              target = i;
              break;
            }
          }
          setCurrentWordIndex(target);
        }
        return;
      }

      // Audio play (K). Space is now reserved for cell navigation, so
      // audio moves off to a single-letter shortcut that doesn't collide
      // with the typewriter input.
      if ((e.key === 'k' || e.key === 'K') && sentence.audio_url) {
        e.preventDefault();
        playAudio();
        return;
      }
      // Smart navigation — Space 跳下一格。Shift+Space 故意不用:中文 IME
      // (微软拼音/搜狗) 把 Shift+Space 截获用于切中英文,无法可靠触发
      // 智能上一格。Backspace 在 cell 空时承担「上一格」角色。
      //
      // 读 stateRef.current.currentWordIndex 而非 useCallback 闭包:submit
      // 触发 setCurrentWordIndex 后,handler 闭包可能仍是旧值(React state
      // 更新异步 + useEffect 重建 listener 有时序差)。读 stateRef 总
      // 是最新值。smartNextIndex 内部已用 stateRef 读 wordResults/confirmed。
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const { currentWordIndex } = stateRef.current;
        const target = smartNextIndex(currentWordIndex, 1);
        setCurrentWordIndex(target);
        inputRef.current?.focus();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setIsPeeking(true);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '/') setIsPeeking(false);
      // Drop the released key from activeKeys. Same normalization as
      // keydown so ' ' (space) matches 'space'.
      const trackedKey =
        e.key === ' ' || e.code === 'Space'
            ? 'space'
            : e.key === 'Backspace'
              ? 'backspace'
              : e.key === '/'
                ? '/'
                : e.key === 'k' || e.key === 'K'
                  ? 'k'
                  : e.key === 'Enter'
                    ? 'enter'
                    : null;
      if (trackedKey) {
        setActiveKeys((prev) => prev.filter((k) => k !== trackedKey));
      }
    };

    // Safety net: if the user alt-tabs away while holding a key, the
    // keyup never fires and the badge would stay lit forever. Clear
    // all tracked keys on window blur.
    const handleBlur = () => setActiveKeys([]);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [expectedWords, playAudio, sentence.audio_url, showReview, handleContinue, handleSkip, smartNextIndex]);

  const stageHints = useMemo(() => {
    // Space → 下一格(智能跳过已对 cell)。
    // Backspace → 上一格(cell 空时智能反向跳;有字符时浏览器默认删字符)。
    // K → 播放音频(原 Space 触发 audio,Space 现在被切格占用)。
    // Shift+Space 故意不用:中文 IME 把它截获用于切中英文。
    const base = sentence.audio_url
      ? [
          { keys: ['Space'], label: '下一格' },
          { keys: ['Backspace'], label: '上一格' },
          { keys: ['K'], label: '播放' },
          { keys: ['/'], label: '偷看' },
        ]
      : [
          { keys: ['Space'], label: '下一格' },
          { keys: ['Backspace'], label: '上一格' },
          { keys: ['/'], label: '偷看' },
        ];
    // 整句提交:让用户知道 Enter 是判分触发器,不是 cell 切换。
    return [
      ...base,
      { keys: ['Enter'], label: '判分' },
      { keys: ['Esc'], label: '跳过' },
    ];
  }, [sentence.audio_url]);

  return (
    <div className={styles.translation}>
      {/* Accessible outcome announcements (the visible wash is aria-hidden). */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </div>
      {showReview ? (
        // Review screen — modal overlay that dims + blurs the drill
        // behind it, then surfaces the answer card and waits for
        // Enter/click to advance. The drill cells stay mounted under
        // .reviewScreen but are visually obscured by the frosted
        // backdrop. role="dialog" + aria-modal announces a modal
        // region to assistive tech; aria-labelledby ties the dialog
        // to its kicker so a screen reader says "答对了, 对话框".
        <div
          className={styles.reviewScreen}
          data-review
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
          onClick={handleContinue}
        >
          <div
            className={styles.reviewCard}
            onClick={(e) => e.stopPropagation()}
          >
          <span
            id="review-title"
            className={
              reviewKind === 'skip'
                ? `${styles.reviewKicker} ${styles.reviewKickerSkip}`
                : styles.reviewKicker
            }
          >
            {reviewKind === 'skip' ? '已跳过' : '答对了'}
          </span>
          <div className={styles.wordCardWrap}>
            <BorderGlow
              className={styles.wordCardShell}
              glowRadius={32}
              glowColor="203 76% 75%"
              glowIntensity={1.0}
              backgroundColor="var(--ds-glass-surface)"
            >
              <div className={styles.wordCard}>
                <h2 className={styles.wordCardWord}>{targetWord.word}</h2>
                {showPhonetic && targetWord.phonetic && (
                  <span className={styles.wordCardPhonetic}>{targetWord.phonetic}</span>
                )}
                {targetWord.translation && (
                  <p className={styles.wordCardTranslation}>{targetWord.translation}</p>
                )}
              </div>
            </BorderGlow>
          </div>
          <div className={styles.reviewSentence}>
            {sentence.chinese_text && (
              <p className={styles.reviewChinese} lang="zh">
                {sentence.chinese_text}
              </p>
            )}
            <p className={styles.reviewEnglish}>{sentence.text}</p>
          </div>
          <button
            type="button"
            className={styles.reviewContinue}
            onClick={handleContinue}
            autoFocus
          >
            <kbd className={styles.reviewKey}>Enter</kbd>
            <span className={styles.reviewHint}>继续下一题 →</span>
          </button>
          </div>
        </div>
      ) : (
        <>
      {feedback && (
        <div
          className={
            styles.feedbackWash +
            (feedback === 'correct' ? ` ${styles.feedbackCorrect}` : ` ${styles.feedbackWrong}`)
          }
          aria-hidden
        />
      )}
      <header className={styles.header}>
        <div className={styles.wordCardWrap}>
          <BorderGlow
            className={styles.wordCardShell}
            glowRadius={32}
            glowColor="203 76% 75%"
            glowIntensity={1.0}
            backgroundColor="var(--ds-glass-surface)"
          >
            <div className={styles.wordCard}>
              <h2 className={styles.wordCardWord}>{targetWord.word}</h2>
              {showPhonetic && targetWord.phonetic && (
                <span className={styles.wordCardPhonetic}>{targetWord.phonetic}</span>
              )}
              {targetWord.translation && (
                <p className={styles.wordCardTranslation}>{targetWord.translation}</p>
              )}
            </div>
          </BorderGlow>
          <IconButton
            className={styles.replayBtn}
            variant="ghost"
            size="md"
            shape="circle"
            aria-label="播放音频"
            disabled={!sentence.audio_url}
            onClick={playAudio}
          >
            <SpeakerIcon />
          </IconButton>
        </div>
        <span className={styles.captionBadgeInline}>看中文，写英文</span>
      </header>

      <div className={styles.sentence}>
        {sentence.chinese_text && (
          <div className={styles.promptRow}>
            <p className={styles.prompt} lang="zh">
              {sentence.chinese_text}
            </p>
          </div>
        )}

        <div className={styles.sentenceDisplay}>
          <div className={styles.sentenceCells}>
            {expectedWords.map((word, index) => {
              const isCorrectWord = wordResults[index];
              const isActive = currentWordIndex === index;
              const isConfirmedWrong =
                wordConfirmed[index] && !isCorrectWord;
              const input = userInputs[index] || '';
              const showPeek = isPeeking && isActive;

              return (
                <span key={`cell-${index}`} className={styles.cellsItem}>
                  <span
                    className={
                      styles.cell +
                      (isCorrectWord ? ` ${styles.cellCorrect}` : '') +
                      (isConfirmedWrong ? ` ${styles.cellWrong}` : '') +
                      (isActive ? ` ${styles.cellActive}` : '')
                    }
                  >
                    <span className={styles.cellGhost} aria-hidden>{word}</span>
                    {showPeek ? (
                      <span className={`${styles.cellText} ${styles.cellTextPeek}`}>{word}</span>
                    ) : isCorrectWord ? (
                      <span className={styles.cellText}>{word}</span>
                    ) : isConfirmedWrong || isActive || input ? (
                      <span
                        className={
                          input.length > 11
                            ? `${styles.cellInput} ${styles.cellInputTruncate}`
                            : overflowIndex === index
                              ? `${styles.cellInput} ${styles.cellOverflow}`
                              : styles.cellInput
                        }
                      >
                        {input}
                        {isActive && (
                          <span className={styles.cellCursor} aria-hidden />
                        )}
                      </span>
                    ) : (
                      <span className={styles.cellPlaceholder}></span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>

          <input
            ref={inputRef}
            type="text"
            className={styles.typewriterInput}
            data-typewriter="true"
            value={userInputs[currentWordIndex] || ''}
            maxLength={expectedWords[currentWordIndex]?.length || 0}
            onChange={(e) => handleWordChange(currentWordIndex, e.target.value)}
            onKeyDown={handleTypewriterKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
              if (compositionTimerRef.current) clearTimeout(compositionTimerRef.current);
              compositionTimerRef.current = setTimeout(() => {
                isComposingRef.current = false;
                compositionTimerRef.current = null;
              }, 3000);
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              if (compositionTimerRef.current) {
                clearTimeout(compositionTimerRef.current);
                compositionTimerRef.current = null;
              }
              const finalValue = (e.target as HTMLInputElement).value;
              handleWordChange(currentWordIndex, finalValue);
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <audio ref={audioRef} />
      </div>

      <button
        type="button"
        className={styles.skipBtn}
        onClick={handleSkip}
        disabled={showReview}
      >
        跳过这道题
      </button>
      <SunkenShortcutBar
        hints={stageHints}
        activeKeys={activeKeys}
        autoPlay={
          sentence.audio_url
            ? { active: autoPlayOn, onToggle: toggleAutoPlay }
            : undefined
        }
      />
        </>
      )}
    </div>
  );
}

/** Compact speaker icon for the audio-replay button. Inherits color via
 *  currentColor so the button's --ds-action-deep tint applies. */
function SpeakerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}