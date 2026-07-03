'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getAudioUrl,
  Sentence,
  WordInLesson,
} from './api';
import SunkenShortcutBar from './SunkenShortcutBar';

interface DictationStageProps {
  /** The sentence to dictate. One sentence per Stage 2 invocation. */
  sentence: Sentence;
  /** The target word the user is supposed to learn in this lesson step.
   *  Used for visual emphasis (no semantic behavior change today). */
  targetWord: WordInLesson;
  /** Called when the user finishes typing the sentence correctly.
   *  `correct` is true for a clean completion, false for a "skip". */
  onComplete: (correct: boolean) => void;
}

// Normalize a string for comparison: lowercase, strip punctuation, collapse
// whitespace. Mirrors what the old backend validate_answer() did.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAnswerCorrect(sentence: Sentence, userInput: string): boolean {
  return normalize(sentence.text) === normalize(userInput);
}

/**
 * DictationStage — Stage 2 of a target word's 2-stage ladder.
 *
 * The original dictation UX extracted from page.tsx: per-cell typewriter
 * inputs, auto-complete on match, peek (`/`), Space = play/pause, Tab
 * between cells, key-tap sounds, IME-friendly composition handling.
 *
 * Lifecycle:
 *   - Mounts → loads `sentence`, plays its audio (autoplay, 400ms delay)
 *   - User types → per-cell feedback
 *   - Last cell correct → 300ms celebration pause → onComplete(true)
 *   - "跳过" button → onComplete(false) — word stays at stage 1
 *
 * The component owns ALL dictation state (userInputs, wordResults,
 * currentWordIndex, audio refs, IME refs). The parent never sees it.
 */
export default function DictationStage({
  sentence,
  targetWord,
  onComplete,
}: DictationStageProps) {
  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<boolean[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [justErred, setJustErred] = useState(false);
  // DESIGN.md v2d — peek the active cell's correct word while `/` is held.
  const [isPeeking, setIsPeeking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // IME 中文输入法状态：composition 期间不污染 userInputs。
  const isComposingRef = useRef(false);
  // IME 半挂起兜底：macOS Enter 静默丢弃拼音不触发 compositionend。
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const expectedWords = sentence.text.split(/\s+/);

  // Per-sentence reset on mount.
  useEffect(() => {
    setUserInputs(new Array(expectedWords.length).fill(''));
    setWordResults(new Array(expectedWords.length).fill(false));
    setCurrentWordIndex(0);
    if (compositionTimerRef.current) {
      clearTimeout(compositionTimerRef.current);
      compositionTimerRef.current = null;
    }
    isComposingRef.current = false;
  }, [sentence.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Autoplay on mount (matching the original page.tsx pattern).
  useEffect(() => {
    const t = setTimeout(() => {
      playAudioInternal();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.id]);

  // Focus the hidden typewriter input on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, [sentence.id]);

  // 兜底焦点续命 — even if cells / buttons stopPropagation clicks, the
  // document-level capture-phase listener forces focus back to the input.
  useEffect(() => {
    const refocus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input:not(.typewriter-input), textarea, [contenteditable="true"]')) return;
      if (target.closest('[role="menu"], [role="listbox"]')) return;
      inputRef.current?.focus();
    };
    document.addEventListener('click', refocus, true);
    return () => document.removeEventListener('click', refocus, true);
  }, []);

  // Global keyboard handler — DESIGN.md v2d shortcut set, scoped to
  // this stage (mounted = active, unmounted = inactive).
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return !!el.closest(
        'input:not(.typewriter-input), textarea, [contenteditable="true"]'
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (expectedWords.length === 0) return;
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
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentWordIndex, expectedWords]);  // eslint-disable-line react-hooks/exhaustive-deps

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
        // Last cell correct → 300ms celebration pause, then advance.
        setTimeout(() => {
          const fullInput = newInputs.join(' ');
          if (fullInput.trim()) {
            const correct = isAnswerCorrect(sentence, fullInput);
            if (correct) {
              playCorrectChime();
              onComplete(true);
            }
          }
        }, 300);
      }
    } else if (value.length >= (expectedWords[index]?.length ?? 0)) {
      // Typed enough characters that the word is wrong → shake.
      setJustErred(true);
      setTimeout(() => setJustErred(false), 400);
    }
  };

  // Typewriter onKeyDown: only IME housekeeping + preventDefault for the
  // keys the global handler also catches. The global handler does the
  // semantic work (Space / Tab / /).
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
    if (e.key === 'Tab' || e.key === ' ' || e.key === '/') {
      e.preventDefault();
    }
  };

  // ---- Audio ----
  const playAudioInternal = useCallback(() => {
    const audioUrl = sentence.audio_url;
    if (!audioUrl) return;
    const fullUrl = getAudioUrl(audioUrl);
    if (audioRef.current) {
      audioRef.current.src = fullUrl;
      audioRef.current.play().catch(() => {});
    }
  }, [sentence.audio_url]);

  // 答对提示音：C 大调三音连奏上行 E5 → G5 → C6（Web Audio API 程序化生成，零依赖）。
  const playCorrectChime = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {
        return;
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const notes = [
      { freq: 659.25, start: 0,    dur: 0.11 },
      { freq: 783.99, start: 0.10, dur: 0.11 },
      { freq: 1046.5, start: 0.20, dur: 0.18 },
    ];

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.25;
    masterGain.connect(ctx.destination);

    const now = ctx.currentTime;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = note.freq;
      const t = now + note.start;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + 0.01);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.03);
      gain.gain.setValueAtTime(0.4, t + note.dur - 0.07);
      gain.gain.linearRampToValueAtTime(0, t + note.dur);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(t);
      osc.stop(t + note.dur + 0.01);
    }
  }, []);

  // 按键音效：双音反馈 —— 正确=清脆"嘀",错误=沉重"咚"。
  const lastTapTimeRef = useRef(0);
  const playKeyTap = useCallback((correct: boolean) => {
    const now = performance.now();
    if (now - lastTapTimeRef.current < 35) return;
    lastTapTimeRef.current = now;

    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {
        return;
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const cfg = correct
      ? { freq: 300, dur: 0.05, type: 'triangle' as OscillatorType, peak: 0.04 }
      : { freq: 120, dur: 0.08, type: 'sine'     as OscillatorType, peak: 0.063 };

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cfg.type;
    osc.frequency.value = cfg.freq;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(cfg.peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + cfg.dur + 0.005);
  }, []);

  // 按键音触发：监听 active cell 输入长度变化,只在新增字符时发声。
  const prevTapRef = useRef<{ wordIdx: number; len: number }>({ wordIdx: -1, len: 0 });
  useEffect(() => {
    const currentInput = userInputs[currentWordIndex] || '';
    const expectedWord = expectedWords[currentWordIndex] || '';
    const prev = prevTapRef.current;

    if (prev.wordIdx !== currentWordIndex) {
      prevTapRef.current = { wordIdx: currentWordIndex, len: currentInput.length };
      return;
    }

    if (currentInput.length > prev.len && expectedWord) {
      const lastIdx = currentInput.length - 1;
      const lastChar = currentInput[lastIdx];
      const expectedChar = expectedWord[lastIdx];
      if (lastChar && expectedChar) {
        const isCorrect = lastChar.toLowerCase() === expectedChar.toLowerCase();
        playKeyTap(isCorrect);
      }
    }

    prevTapRef.current = { wordIdx: currentWordIndex, len: currentInput.length };
  }, [userInputs, currentWordIndex, expectedWords, playKeyTap]);

  const handleTogglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      playAudioInternal();
    } else {
      audioRef.current.pause();
    }
  }, [playAudioInternal]);

  const handleSkip = () => {
    onComplete(false);
  };

  return (
    <div className="dictation">
      <audio ref={audioRef} />

      <p className="dictation__caption" lang="zh-CN">
        听写 · {targetWord.word}
      </p>

      {sentence.chinese_text && (
        <p className="dictation__hint" lang="zh-CN">
          {sentence.chinese_text}
        </p>
      )}

      <div className="sentence">
        <div className="sentence__display">
          <div className="sentence__cells">
            {expectedWords.map((word, index) => {
              const isCorrectWord = wordResults[index];
              const isActive = currentWordIndex === index;
              const input = userInputs[index] || '';
              const showPeek = isPeeking && isActive;

              return (
                <span key={`cell-${index}`} className="cells__item">
                  <span
                    className={
                      'cell' +
                      (isCorrectWord ? ' cell--correct' : '') +
                      (isActive ? ' cell--active' : '') +
                      (justErred && isActive ? ' cell--shake' : '')
                    }
                  >
                    <span className="cell__ghost" aria-hidden>{word}</span>
                    {showPeek ? (
                      <span className="cell__text cell__text--peek">{word}</span>
                    ) : isCorrectWord ? (
                      <span className="cell__text">{word}</span>
                    ) : isActive ? (
                      <span className="cell__input">
                        {input.split('').map((char, i) => {
                          const status = char?.toLowerCase() === word[i]?.toLowerCase() ? 'correct' : 'wrong';
                          return <span key={i} className={`cell__char cell__char--${status}`}>{char}</span>;
                        })}
                        <span className="cell__cursor" aria-hidden>|</span>
                      </span>
                    ) : (
                      <span className="cell__placeholder"></span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="typewriter-input"
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

      <SunkenShortcutBar />

      <div className="dictation__actions">
        <button
          type="button"
          className="dictation__skip"
          onClick={handleSkip}
        >
          跳过本词
        </button>
      </div>
    </div>
  );
}
