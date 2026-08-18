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
  // Whether the correct English sentence is revealed (after a skip) so the
  // user can learn from the miss before advancing.
  const [revealed, setRevealed] = useState(false);
  // Page-level correct/wrong wash — a brief full-bleed tint that confirms
  // the outcome of a step without needing a modal. Auto-clears after ~900ms.
  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong'>(null);
  // Screen-reader announcement for step outcomes. The visible feedback
  // wash is aria-hidden, so this region is its accessible equivalent.
  // The wrong-answer case is announced by the .answer panel's own
  // aria-live, so we only drive this region for correct / reset.
  const [announce, setAnnounce] = useState('');
  const feedbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const flashFeedback = useCallback((kind: 'correct' | 'wrong') => {
    setFeedback(kind);
    if (kind === 'correct') setAnnounce('答对了');
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 900);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Mirror the latest typing state into a ref so global/keyboard handlers
  // (and cell-nav) can grade the active cell without stale closures.
  const stateRef = useRef({
    userInputs,
    wordResults,
    currentWordIndex,
  });
  stateRef.current = { userInputs, wordResults, currentWordIndex };

  // Per-sentence reset on mount or sentence change.
  useEffect(() => {
    setUserInputs(new Array(expectedWords.length).fill(''));
    setWordResults(new Array(expectedWords.length).fill(false));
    setWordConfirmed(new Array(expectedWords.length).fill(false));
    setCurrentWordIndex(0);
    setRevealed(false);
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
  // Retry — reset the cells for the SAME sentence so the user can type it
  // again after a miss. The per-sentence reset effect only fires on
  // sentence.id change, so we reset manually here (same id is reused).
  const retry = () => {
    setUserInputs(new Array(expectedWords.length).fill(''));
    setWordResults(new Array(expectedWords.length).fill(false));
    setCurrentWordIndex(0);
    setRevealed(false);
    setFeedback(null);
    setAnnounce('已重置，请重新输入');
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    window.setTimeout(() => inputRef.current?.focus(), 60);
  };

  // Reveal the full correct sentence (the single "看答案" action). Per-word
  // grading is handled by Enter / cell navigation; this just uncovers the
  // answer + partial credit once the user gives up on a word.
  const revealAnswer = () => {
    if (revealed) return;
    setRevealed(true);
    flashFeedback('wrong');
    playWrongBuzz();
  };

  // Grade the active cell against the expected word, flagging a wrong
  // (non-empty) attempt as confirmed so it stays red after the caret
  // leaves. Reads the ref mirror for always-fresh state in any handler.
  const gradeCurrentCell = useCallback(() => {
    const { userInputs: ui, wordResults: wr, currentWordIndex: ci } =
      stateRef.current;
    const raw = (ui[ci] || '').trim();
    if (!raw) return;
    if (wr[ci]) return;
    setWordConfirmed((prev) => {
      if (prev[ci]) return prev;
      const next = [...prev];
      next[ci] = true;
      return next;
    });
  }, []);

  // Move to an adjacent cell, grading the one we're leaving first. Used by
  // the on-screen cell-nav control (essential on touch, where Tab/Shift-Tab
  // are unavailable) and the keyboard Tab handler below.
  const goCell = useCallback(
    (delta: number) => {
      gradeCurrentCell();
      setCurrentWordIndex((i) => {
        const next = Math.min(Math.max(i + delta, 0), expectedWords.length - 1);
        return next;
      });
      inputRef.current?.focus();
    },
    [expectedWords.length, gradeCurrentCell],
  );

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

  // ---- Cell typing ----
  const handleWordChange = (index: number, value: string) => {
    if (isComposingRef.current) {
      return;
    }

    const newInputs = [...userInputs];
    newInputs[index] = value;
    setUserInputs(newInputs);

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
        // Last cell correct → 300ms celebration, then advance.
        flashFeedback('correct');
        window.setTimeout(() => {
          playCorrectChime();
          onComplete(true);
        }, 300);
      }
    }
  };

  // Confirm the CURRENT word as a whole unit (Enter key). Grade it: flag a
  // wrong (non-empty) attempt as confirmed-wrong so the cell renders the
  // whole word in red, then advance to the next word — symmetric with the
  // auto-advance on a correct word, so the caret never sticks on a cell
  // the user has already judged. Empty / already-correct cells are skipped.
  const confirmWord = useCallback(() => {
    const { userInputs: ui, wordResults: wr, currentWordIndex: ci } =
      stateRef.current;
    const raw = (ui[ci] || '').trim();
    if (!raw) return;
    if (wr[ci]) return;
    gradeCurrentCell();
    playWrongBuzz();
    setCurrentWordIndex((i) => Math.min(i + 1, expectedWords.length - 1));
  }, [expectedWords.length, gradeCurrentCell, playWrongBuzz]);

  // Typewriter onKeyDown: IME housekeeping + preventDefault for the
  // keys the global handler also catches.
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
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmWord();
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

      // Mark this key as held — lights up the matching kbd badge in
      // the shortcut bar. We only track keys that have a registered
      // shortcut in this stage (Space / Tab / '/') so the bar only
      // shows what the user can actually do.
      const trackedKey =
        e.key === ' ' || e.code === 'Space'
          ? 'space'
          : e.key === 'Tab'
            ? 'tab'
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
        // Grade the cell we're leaving before cycling — Enter-style grading
        // so a wrong attempt shows red even when navigated away via Tab.
        gradeCurrentCell();
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
  }, [currentWordIndex, expectedWords, playAudio, sentence.audio_url]);

  return (
    <div className={styles.translation}>
      {/* Accessible outcome announcements (the visible wash is aria-hidden). */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </div>
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
        <span className={styles.captionBadgeInline}>看中文写英文</span>
        {!sentence.audio_url && (
          <span className={styles.noAudio} aria-hidden>无音频</span>
        )}
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
                    ) : isConfirmedWrong || isActive ? (
                      <span className={styles.cellInput}>
                        {input}
                        {isActive && (
                          <span className={styles.cellCursor} aria-hidden>|</span>
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

        {/* On-screen cell navigation — the desktop path uses Tab /
            Shift-Tab, but touch devices have no keyboard, so we expose a
            prev/next control + a live "N / M" position readout. */}
        <div className={styles.cellNav}>
          <button
            type="button"
            className={styles.cellNavBtn}
            onClick={() => goCell(-1)}
            disabled={currentWordIndex === 0}
            aria-label="上一格"
          >
            ← 上一格
          </button>
          <span className={styles.cellNavPos} aria-hidden>
            {currentWordIndex + 1} / {expectedWords.length}
          </span>
          <button
            type="button"
            className={styles.cellNavBtn}
            onClick={() => goCell(1)}
            disabled={currentWordIndex === expectedWords.length - 1}
            aria-label="下一格"
          >
            下一格 →
          </button>
        </div>
      </div>

      <SunkenShortcutBar
        hints={
          sentence.audio_url
              ? [
                { keys: ['Enter'], label: '确认本词' },
                { keys: ['Space'], label: '播放' },
                { keys: ['Tab'], label: '切换格子' },
                { keys: ['/'], label: '偷看' },
              ]
            : [
                { keys: ['Enter'], label: '确认本词' },
                { keys: ['Tab'], label: '切换格子' },
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

      {revealed && (
        <div className={styles.answer} aria-live="polite">
          <p className={styles.answerLabel}>正确答案</p>
          <p className={styles.answerText}>{sentence.text}</p>
          <p className={styles.answerPartial}>
            你答对了 {wordResults.filter(Boolean).length} / {expectedWords.length} 个词
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {revealed ? (
          <>
            <SpecularButton
              size="sm"
              onClick={retry}
              tint="var(--ds-action)"
              tintOpacity={0.18}
              baseColor="transparent"
              lineColor="var(--ds-action-deep)"
              textColor="var(--ds-action-deep)"
              blur={6}
              intensity={0.6}
              followMouse
              proximity={220}
            >
              重试 ↺
            </SpecularButton>
            <Button variant="primary" size="sm" onClick={() => onComplete(false)}>
              继续下一句 →
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={revealAnswer}>
              看答案
            </Button>
          </>
        )}
      </div>
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