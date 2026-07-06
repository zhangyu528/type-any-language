'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getAudioUrl,
  LessonSentence,
  WordInLesson,
} from './api';
import SunkenShortcutBar from './SunkenShortcutBar';

interface TranslationStageProps {
  /** The sentence being practiced — `chinese_text` is the prompt (what
   *  the user sees), `text` is the English reference shown after a
   *  wrong answer. */
  sentence: LessonSentence;
  /** 0-based step index in the lesson's flat step ladder (all words ×
   *  all sentences for that word, in order). */
  stepIndex: number;
  /** Total steps in the lesson. */
  totalSteps: number;
  /** Target word — used only for the caption "看中文写英文 · {word}". */
  targetWord: WordInLesson;
  /** Called when the user finishes a step. `correct` is true on a clean
   *  check, false on "skip". */
  onComplete: (correct: boolean) => void;
}

/**
 * TranslationStage — single step of the standalone ZH→EN drill.
 *
 * UX:
 *   - Top: step dots + counter
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
 */
export default function TranslationStage({
  sentence,
  stepIndex,
  totalSteps,
  targetWord,
  onComplete,
}: TranslationStageProps) {
  const expectedWords = sentence.text.split(/\s+/);

  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<boolean[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [justErred, setJustErred] = useState(false);
  const [isPeeking, setIsPeeking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Per-sentence reset on mount or sentence change.
  useEffect(() => {
    setUserInputs(new Array(expectedWords.length).fill(''));
    setWordResults(new Array(expectedWords.length).fill(false));
    setCurrentWordIndex(0);
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

  // Refocus the typewriter if a stray click lands somewhere outside
  // editable surfaces — same pattern DictationStage used. Without this,
  // stopPropagation'd button clicks can leave focus stranded and
  // subsequent keypresses won't reach the cells.
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

  const playAudio = useCallback(() => {
    if (!sentence.audio_url) return;
    try {
      if (audioRef.current) {
        audioRef.current.src = getAudioUrl(sentence.audio_url);
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => { /* 静默 */ });
      }
    } catch {
      /* 静默 */
    }
  }, [sentence.audio_url]);

  const skip = () => {
    onComplete(false);
  };

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
        window.setTimeout(() => {
          playCorrectChime();
          onComplete(true);
        }, 300);
      }
    } else if (value.length >= (expectedWords[index]?.length ?? 0)) {
      // Typed enough chars but the word is wrong → shake.
      setJustErred(true);
      window.setTimeout(() => setJustErred(false), 400);
    }
  };

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
      return !!el.closest(
        'input:not(.typewriter-input), textarea, [contenteditable="true"]'
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if ((e.key === ' ' || e.code === 'Space') && sentence.audio_url) {
        e.preventDefault();
        playAudio();
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
  }, [currentWordIndex, expectedWords, playAudio, sentence.audio_url]);

  return (
    <div className="translation">
      <header className="translation__header">
        <p className="translation__caption">看中文写英文 · {targetWord.word}</p>
        <div className="translation__steps" aria-label="step progress">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={
                'translation__step-dot' +
                (i < stepIndex ? ' translation__step-dot--done' : '') +
                (i === stepIndex ? ' translation__step-dot--current' : '')
              }
              aria-hidden
            />
          ))}
        </div>
        <p className="translation__counter">
          {stepIndex + 1} / {totalSteps}
        </p>
      </header>

      <div className="sentence">
        {sentence.chinese_text && (
          <p className="translation__prompt" lang="zh">
            {sentence.chinese_text}
          </p>
        )}

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

        <audio ref={audioRef} />
      </div>

      <SunkenShortcutBar
        hints={
          sentence.audio_url
            ? [
                { keys: ['Space'], label: '播放' },
                { keys: ['Tab'], label: '切换格子' },
                { keys: ['/'], label: '偷看' },
              ]
            : [
                { keys: ['Tab'], label: '切换格子' },
                { keys: ['/'], label: '偷看' },
              ]
        }
      />

      <div className="translation__actions">
        <button type="button" className="translation__btn translation__btn--ghost" onClick={skip}>
          跳过 ⏭
        </button>
      </div>
    </div>
  );
}