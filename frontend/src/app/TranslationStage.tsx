'use client';

import { useState, useEffect, useRef } from 'react';
import {
  getAudioUrl,
  LessonSentence,
  WordInLesson,
} from './api';
import { validateEn, validateZh } from './normalize';
import SunkenShortcutBar from './SunkenShortcutBar';

export type TranslationDirection = 'en2zh' | 'zh2en';

interface TranslationStageProps {
  /** The sentence being practiced. `chinese_text` is the reference for EN→ZH;
   *  `text` is the reference for ZH→EN. */
  sentence: LessonSentence;
  /** Which direction this step is. */
  direction: TranslationDirection;
  /** 0-based step index in the lesson's 5-step ladder. */
  stepIndex: number;
  /** Total steps in the lesson (5 for a normal lesson). */
  totalSteps: number;
  /** Target word — used only for the caption "翻译 · {word}". */
  targetWord: WordInLesson;
  /** Called when the user finishes a step. `correct` is true on a clean
   *  check, false on "skip". */
  onComplete: (correct: boolean) => void;
}

/**
 * TranslationStage — single step of the standalone translation drill.
 *
 * UX:
 *   - Top: step dots + counter
 *   - Middle: prompt (English sentence for EN→ZH, Chinese for ZH→EN)
 *   - Below prompt: textarea for user input
 *   - Bottom: play / check / skip button row + SunkenShortcutBar
 *
 * Validation (per direction):
 *   - EN→ZH: validateZh(input, sentence.chinese_text)
 *   - ZH→EN: validateEn(input, sentence.text)
 *
 * On correct: 300ms chime + onComplete(true).
 * On wrong: reveal reference + "再试一次" button (resets input, stays on step).
 * On skip: onComplete(false).
 *
 * Audio:
 *   - EN→ZH: autoplay English sentence audio on mount; user can replay via 🔊.
 *   - ZH→EN: no audio (chinese_text has no TTS). The 🔊 button is hidden.
 */
export default function TranslationStage({
  sentence,
  direction,
  stepIndex,
  totalSteps,
  targetWord,
  onComplete,
}: TranslationStageProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // IME composition state — same pattern as DictationStage.
  const isComposingRef = useRef(false);
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state when the step changes.
  useEffect(() => {
    setInput('');
    setError('');
    if (compositionTimerRef.current) {
      clearTimeout(compositionTimerRef.current);
      compositionTimerRef.current = null;
    }
    isComposingRef.current = false;
  }, [sentence.id, direction]);

  // Autoplay English audio on mount for EN→ZH. 400ms matches DictationStage.
  useEffect(() => {
    if (direction !== 'en2zh') return;
    if (!sentence.audio_url) return;
    const t = window.setTimeout(() => {
      try {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => { /* autoplay-blocked 静默 */ });
        }
      } catch {
        /* 静默 */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [sentence.id, direction, sentence.audio_url]);

  const playAudio = () => {
    if (direction !== 'en2zh' || !sentence.audio_url) return;
    try {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => { /* 静默 */ });
      }
    } catch {
      /* 静默 */
    }
  };

  const check = () => {
    const inputNow = input;
    const ok =
      direction === 'en2zh'
        ? validateZh(inputNow, sentence.chinese_text)
        : validateEn(inputNow, sentence.text);
    if (ok) {
      // 300ms chime + advance.
      playCorrectChime();
      window.setTimeout(() => onComplete(true), 300);
    } else {
      setError(direction === 'en2zh' ? '参考答案已显示，可再试一次或跳过' : '参考答案已显示，可再试一次或跳过');
    }
  };

  const retry = () => {
    setInput('');
    setError('');
    inputRef.current?.focus();
  };

  const skip = () => {
    onComplete(false);
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!error) check();
        else retry();
        return;
      }
      if (e.key === ' ' && direction === 'en2zh' && !isComposingRef.current) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return;
        e.preventDefault();
        playAudio();
        return;
      }
      if (e.key === 'Tab' && !isComposingRef.current) {
        if (error) {
          e.preventDefault();
          retry();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, error, input, sentence.id]);

  const prompt = direction === 'en2zh' ? sentence.text : sentence.chinese_text;
  const reference = direction === 'en2zh' ? sentence.chinese_text : sentence.text;
  const promptLang = direction === 'en2zh' ? 'en' : 'zh';
  const placeholder = direction === 'en2zh' ? '输入中文翻译…' : 'Type the English translation…';
  const directionLabel = direction === 'en2zh' ? 'EN → 中文' : '中文 → EN';

  return (
    <div className="translation">
      <header className="translation__header">
        <p className="translation__caption">翻译 · {targetWord.word}</p>
        <p className="translation__direction">{directionLabel}</p>
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

      <div className="translation__prompt" lang={promptLang}>
        {prompt}
      </div>

      {error && (
        <div className="translation__answer" role="status">
          <p className="translation__answer-label">参考答案</p>
          <p className="translation__answer-text" lang={promptLang === 'en' ? 'zh' : 'en'}>
            {reference}
          </p>
        </div>
      )}

      <textarea
        ref={inputRef}
        className={
          'translation__textarea' +
          (error ? ' translation__textarea--error' : '')
        }
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          if (error) setError('');
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
          if (compositionTimerRef.current) {
            clearTimeout(compositionTimerRef.current);
          }
        }}
        onCompositionEnd={() => {
          // 一些 IME 在 Enter 后不发 compositionend — 加 3s 兜底
          compositionTimerRef.current = setTimeout(() => {
            isComposingRef.current = false;
          }, 0);
        }}
        placeholder={placeholder}
        rows={2}
        autoFocus
        spellCheck={false}
        lang={direction === 'en2zh' ? 'zh' : 'en'}
      />

      <div className="translation__actions">
        {direction === 'en2zh' && sentence.audio_url ? (
          <button type="button" className="translation__btn translation__btn--ghost" onClick={playAudio}>
            🔊 播放
          </button>
        ) : null}

        {error ? (
          <button type="button" className="translation__btn translation__btn--ghost" onClick={retry}>
            再试一次
          </button>
        ) : (
          <button type="button" className="translation__btn translation__btn--primary" onClick={check}>
            检查 ✓
          </button>
        )}

        <button type="button" className="translation__btn translation__btn--ghost" onClick={skip}>
          跳过 ⏭
        </button>
      </div>

      <SunkenShortcutBar
        hints={
          direction === 'en2zh'
            ? [
                { keys: ['Space'], label: '播放' },
                { keys: ['Cmd', 'Enter'], label: '检查' },
                { keys: ['Tab'], label: '再试一次' },
              ]
            : [
                { keys: ['Cmd', 'Enter'], label: '检查' },
                { keys: ['Tab'], label: '再试一次' },
              ]
        }
      />

      {direction === 'en2zh' && sentence.audio_url && (
        <audio
          ref={audioRef}
          src={getAudioUrl(sentence.audio_url)}
          preload="auto"
        />
      )}
    </div>
  );
}

/**
 * 300ms E5→G5→C6 triangle-wave chime via Web Audio. Same pattern
 * DictationStage uses for sentence completion — cheap, no asset, sounds nice.
 */
function playCorrectChime(): void {
  try {
    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [659.25, 783.99, 1046.5]; // E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.09;
      const stop = start + 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, stop);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(stop);
    });
    // Clean up context after the last note.
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* 静默 */
  }
}