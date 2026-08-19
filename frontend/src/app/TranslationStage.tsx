'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  // Review screen — flips to true once the last cell is correct. The
  // 300ms celebration (chime + mint wash) plays first, then we swap
  // the drill surface for a static review surface and wait for the
  // user to press Enter to hand control back to the parent.
  const [showReview, setShowReview] = useState(false);
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
    setShowReview(false);
    onComplete(true);
  }, [onComplete]);

  // Per-sentence reset on mount or sentence change.
  useEffect(() => {
    if (overflowTimerRef.current) {
      clearTimeout(overflowTimerRef.current);
      overflowTimerRef.current = null;
    }
    setOverflowIndex(null);
    setShowReview(false);
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
  const handleWordChange = (index: number, value: string) => {
    if (isComposingRef.current) {
      return;
    }

    const newInputs = [...userInputs];
    newInputs[index] = value;
    setUserInputs(newInputs);

    // Any new typing clears the confirmed-wrong state for this cell —
    // the user is refining their guess, so the cell should look like a
    // fresh attempt (gray) until they press Enter again. We only
    // dispatch when the flag is actually set, to avoid an extra render
    // on the common path (first-time typing into a clean cell).
    if (wordConfirmed[index]) {
      setWordConfirmed((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        next[index] = false;
        return next;
      });
    }

    const expected = expectedWords[index]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
    const input = value.toLowerCase().replace(/[.,!?;:'"]/g, '');

    const isWordCorrect = input === expected;
    const newResults = [...wordResults];
    newResults[index] = isWordCorrect;
    setWordResults(newResults);

    if (isWordCorrect) {
      // Auto-complete with correct case.
      newInputs[index] = expectedWords[index];
      setUserInputs(newInputs);

      if (index < expectedWords.length - 1) {
        setCurrentWordIndex(index + 1);
      } else {
        // Last cell correct → 300ms celebration, then flip to the
        // review screen. The user presses Enter to actually advance;
        // we don't call onComplete(true) here so the parent stays
        // out of the way until the user is ready.
        flashFeedback('correct');
        window.setTimeout(() => {
          playCorrectChime();
          setShowReview(true);
        }, 300);
      }
    }
  };

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
      e.key !== 'Tab' && e.key !== ' ' && e.key !== '/'
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
      e.key !== 'Tab' &&
      e.key !== 'Shift' &&
      e.key !== 'Control' &&
      e.key !== 'Alt' &&
      e.key !== 'Meta'
    ) {
      playKeyboardTick();
    }
    if (e.key === 'Backspace') {
      // Empty cell + Backspace → step back to the previous cell. The cell
      // we leave preserves any typed content (the cell render falls into
      // the `|| input` branch so the text stays visible). When the cell
      // has content we let the browser delete the trailing char.
      const cur = userInputs[currentWordIndex] || '';
      if (cur === '' && currentWordIndex > 0) {
        e.preventDefault();
        setCurrentWordIndex(currentWordIndex - 1);
      }
      return;
    }
    if (e.key === 'Tab' || e.key === ' ' || e.key === '/') {
      e.preventDefault();
    }
  };

  // Global keyboard handler — Space (play audio), Tab (cycle cells), /
  // (peek the active cell's answer).
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
      // the shortcut bar. We only track keys that have a registered
      // shortcut in this stage (Space / Tab / Backspace / '/') so the
      // bar only shows what the user can actually do.
      const trackedKey =
        e.key === ' ' || e.code === 'Space'
          ? 'space'
          : e.key === 'Tab'
            ? 'tab'
            : e.key === 'Backspace'
              ? 'backspace'
              : e.key === '/'
                ? '/'
                : null;
      if (trackedKey) {
        setActiveKeys((prev) => (prev.includes(trackedKey) ? prev : [...prev, trackedKey]));
      }

      if ((e.key === ' ' || e.code === 'Space') && sentence.audio_url) {
        e.preventDefault();
        playAudio();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (expectedWords.length === 0) return;
        // Pure navigation — typing state is preserved on the cell we leave
        // (re-render shows it via the `|| input` short-circuit in the cells
        // loop). Enter is the only key that grades + advances.
        if (e.shiftKey) {
          setCurrentWordIndex(
            (currentWordIndex - 1 + expectedWords.length) % expectedWords.length
          );
        } else {
          setCurrentWordIndex((currentWordIndex + 1) % expectedWords.length);
        }
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
          : e.key === 'Tab'
            ? 'tab'
            : e.key === 'Backspace'
              ? 'backspace'
              : e.key === '/'
                ? '/'
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
  }, [currentWordIndex, expectedWords, playAudio, sentence.audio_url, showReview, handleContinue]);

  return (
    <div className={styles.translation}>
      {/* Accessible outcome announcements (the visible wash is aria-hidden). */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </div>
      {showReview ? (
        // Review screen — shown after a fully-correct sentence. Renders
        // a static "answer card" (word + ZH/EN sentence) and waits for
        // the user to press Enter (or click) to advance. We don't render
        // the drill cells here because the input is locked pending the
        // continue signal.
        <div className={styles.reviewScreen} data-review>
          <span className={styles.reviewKicker}>答对了</span>
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

      <SunkenShortcutBar
        hints={
          showReview
            ? [{ keys: ['Enter'], label: '继续下一题' }]
            : sentence.audio_url
              ? [
                { keys: ['Space'], label: '播放' },
                { keys: ['Tab'], label: '切换格子' },
                { keys: ['Backspace'], label: '上一格' },
                { keys: ['/'], label: '偷看' },
              ]
            : [
                { keys: ['Tab'], label: '切换格子' },
                { keys: ['Backspace'], label: '上一格' },
                { keys: ['/'], label: '偷看' },
              ]
        }
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