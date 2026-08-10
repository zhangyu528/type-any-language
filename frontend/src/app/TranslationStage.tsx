'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  addToCollection,
  getAudioUrl,
  isSentenceCollected,
  LessonSentence,
  readPrefAudioRate,
  readPrefBool,
  removeFromCollection,
  STORAGE_SHOW_PHONETIC,
  WordInLesson,
} from './api';
import { useAuth } from './lib/auth';
import SunkenShortcutBar from './SunkenShortcutBar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import styles from './practice/TranslationStage.module.css';

interface TranslationStageProps {
  /** The sentence being practiced — `chinese_text` is the prompt (what
   *  the user sees), `text` is the English reference shown after a
   *  wrong answer. */
  sentence: LessonSentence;
  /** Target word for the word-card at the top of the stage. */
  targetWord: WordInLesson;
  /** The lib this sentence came from — propagated down so the
   *  collection entry can remember the source for Me-page filtering. */
  libId: string;
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
  libId,
  onComplete,
}: TranslationStageProps) {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const expectedWords = sentence.text.split(/\s+/);

  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<boolean[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [justErred, setJustErred] = useState(false);
  const [isPeeking, setIsPeeking] = useState(false);
  // Track which shortcut keys the user is holding down so the matching
  // kbd badges in the shortcut bar light up. Strings are normalized
  // (lowercase) — see SunkenShortcutBar's matching logic.
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  // Whether this (sentence, word) pair is in the user's collection.
  // Initialized from localStorage on mount/sentence-change; the star
  // button toggles it. Re-read after the collection-changed event so
  // cross-tab updates / future programmatic mutations land here.
  const [isCollected, setIsCollected] = useState<boolean>(false);
  // Transient: set true right after a toggle so the star can run
  // a one-shot pop animation + emit particles. Cleared after the
  // animation duration (see useEffect below) so the next toggle
  // can fire it again.
  const [popping, setPopping] = useState<boolean>(false);
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

  // Sync isCollected state with localStorage on mount / sentence
  // change. The Me page listens for the collection-changed event
  // to update its tab badge — we don't need to, since the star
  // button IS the source of truth here.
  useEffect(() => {
    setIsCollected(isSentenceCollected(sentence.id, userId));
  }, [sentence.id, userId]);

  // Read user-driven prefs on mount + subscribe to changes.
  // - audioRate: Stage applies it on every play() and updates mid-playback
  // - showPhonetic: controls whether the IPA transcription is rendered
  // Same-tab updates come from /me's storage event; cross-tab too.
  useEffect(() => {
    setAudioRate(readPrefAudioRate());
    setShowPhonetic(readPrefBool(STORAGE_SHOW_PHONETIC, true));
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'prefs.audioRate') {
        setAudioRate(readPrefAudioRate());
      } else if (e.key === 'prefs.showPhonetic') {
        setShowPhonetic(readPrefBool(STORAGE_SHOW_PHONETIC, true));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Clear the popping flag once the CSS animation completes so the
  // next toggle can fire it again. The 480ms matches the longest
  // animation (particles fade) in the star CSS.
  useEffect(() => {
    if (!popping) return;
    const t = window.setTimeout(() => setPopping(false), 480);
    return () => window.clearTimeout(t);
  }, [popping]);

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

  const skip = () => {
    onComplete(false);
  };

  // Toggle collection membership for this (sentence, word) pair.
  // Atomic add/remove — collection helpers keep sentences + words
  // in lockstep (1:1 relationship for drill pairs).
  const toggleCollected = useCallback(() => {
    if (isCollected) {
      removeFromCollection(sentence.id, userId);
      setIsCollected(false);
      // No pop on un-favorite — the visual reward lives on the
      // "I just saved this" beat, not the "I un-saved" beat.
    } else {
      addToCollection(sentence.id, targetWord.word, userId, libId);
      setIsCollected(true);
      // Trigger the one-shot pop animation. The useEffect clears
      // the flag 480ms later (matching particle fade).
      setPopping(true);
    }
    // Notify same-tab listeners (MePage badge) and storage event
    // for cross-tab listeners. Same pattern as TranslationSession's
    // progress-changed dispatch — the dual coverage is intentional.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('collection-changed', {
          detail: { sentenceId: sentence.id, added: !isCollected },
        }),
      );
    }
  }, [isCollected, sentence.id, targetWord.word, libId, userId]);

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
      <header className={styles.header}>
        <Card className={styles.wordCardShell}>
          <div className={styles.wordCard}>
            <h2 className={styles.wordCardWord}>{targetWord.word}</h2>
            {showPhonetic && targetWord.phonetic && (
              <span className={styles.wordCardPhonetic}>{targetWord.phonetic}</span>
            )}
            {targetWord.translation && (
              <p className={styles.wordCardTranslation}>{targetWord.translation}</p>
            )}
          </div>
        </Card>
        <Badge variant="slate" className={styles.captionBadge}>看中文写英文</Badge>
      </header>

      <div className={styles.sentence}>
        {sentence.chinese_text && (
          <div className={styles.promptRow}>
            <p className={styles.prompt} lang="zh">
              {sentence.chinese_text}
            </p>
            <button
              type="button"
              className={styles.star}
              data-active={isCollected ? 'true' : 'false'}
              data-popping={popping ? 'true' : 'false'}
              onClick={toggleCollected}
              aria-label={isCollected ? '从收藏移除' : '收藏这句'}
              aria-pressed={isCollected ? 'true' : 'false'}
              title={isCollected ? '从收藏移除' : '收藏这句'}
            >
              {isCollected ? '★' : '☆'}
            </button>
          </div>
        )}

        <div className={styles.sentenceDisplay}>
          <div className={styles.sentenceCells}>
            {expectedWords.map((word, index) => {
              const isCorrectWord = wordResults[index];
              const isActive = currentWordIndex === index;
              const input = userInputs[index] || '';
              const showPeek = isPeeking && isActive;

              return (
                <span key={`cell-${index}`} className={styles.cellsItem}>
                  <span
                    className={
                      styles.cell +
                      (isCorrectWord ? ` ${styles.cellCorrect}` : '') +
                      (isActive ? ` ${styles.cellActive}` : '') +
                      (justErred && isActive ? ` ${styles.cellShake}` : '')
                    }
                  >
                    <span className={styles.cellGhost} aria-hidden>{word}</span>
                    {showPeek ? (
                      <span className={`${styles.cellText} ${styles.cellTextPeek}`}>{word}</span>
                    ) : isCorrectWord ? (
                      <span className={styles.cellText}>{word}</span>
                    ) : isActive ? (
                      <span className={styles.cellInput}>
                        {input.split('').map((char, i) => {
                          const status = char?.toLowerCase() === word[i]?.toLowerCase() ? 'correct' : 'wrong';
                          return <span key={i} className={`${styles.cellChar} ${status === 'correct' ? styles.cellCharCorrect : styles.cellCharWrong}`}>{char}</span>;
                        })}
                        <span className={styles.cellCursor} aria-hidden>|</span>
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
        activeKeys={activeKeys}
      />

      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={skip}>跳过 ⏭</Button>
      </div>
    </div>
  );
}