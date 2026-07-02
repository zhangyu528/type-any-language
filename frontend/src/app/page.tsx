'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateSentences, getAudioUrl, Sentence, getContentCatalog } from './api';
import LibraryPicker from './LibraryPicker';
import SunkenShortcutBar from './SunkenShortcutBar';

// Normalize a string for comparison: lowercase, strip punctuation, collapse
// whitespace. Mirrors what backend's old `validate_answer()` did (CLAUDE.md:
// "User submits answer → validate_answer() normalizes ...").
// Pure local check now that the read-layer backend dropped POST /sentences/check.
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

export default function PracticePage() {
  const [loading, setLoading] = useState(true);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<boolean[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [error, setError] = useState('');
  const [justErred, setJustErred] = useState(false);
  const [sentenceResults, setSentenceResults] = useState<(boolean | null)[]>([]);
  const [sentenceStartTime, setSentenceStartTime] = useState<number>(Date.now());
  // DESIGN.md v2d — peek the active cell's correct word while `/` is held.
  const [isPeeking, setIsPeeking] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  // 自动播放开关 — 持久化到 localStorage,默认开(保持上次 "always auto-play" 体验)。
  // 关掉后:只有用户主动按 Space 才播放;开时:新题目自动播。
  const [autoPlay, setAutoPlay] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('prefs.autoPlay');
      if (saved === null) return true;
      return saved === 'true';
    } catch {
      return true;
    }
  });

  // LibraryPicker selection. Persisted to localStorage so reload preserves
  // the user's pick. Defaults are resolved after the catalog loads — see
  // the catalog-loaded effect below.
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当前句子的派生值 —— 在所有 effect / handler 前计算，避免 TDZ
  // (sentences / currentIndex 都已声明)。
  const currentSentence = sentences[currentIndex];
  // IME 中文输入法状态：composition 期间不污染 userInputs，避免 IME 半挂起导致 Backspace 失效
  const isComposingRef = useRef(false);
  // IME 半挂起兜底：macOS Enter 静默丢弃拼音不触发 compositionend，3 秒后强制 reset
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    initPractice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLibId]);

  // Load the catalog once on mount, then resolve picker selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await getContentCatalog();
        if (cancelled) return;
        if (catalog.libs.length === 0) return;

        const savedLibId = (() => {
          try { return window.localStorage.getItem('prefs.libId'); } catch { return null; }
        })();

        const lib = catalog.libs.find((l) => l.id === savedLibId) ?? catalog.libs[0];

        setSelectedLibId(lib.id);
      } catch {
        // initPractice will surface the error in its own try/catch.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const initPractice = async () => {
    if (!selectedLibId) return;
    setLoading(true);
    setError('');
    try {
      const newSentences = await generateSentences(selectedLibId, 10);
      setSentences(newSentences);
      setCurrentIndex(0);
      setScore({ correct: 0, total: newSentences.length });
      setSentenceResults(new Array(newSentences.length).fill(null));
      setSentenceStartTime(Date.now());
    } catch (err) {
      setError('Failed to load practice');
    } finally {
      setLoading(false);
    }
  };

  const handlePickerChange = useCallback((libId: string) => {
    try {
      window.localStorage.setItem('prefs.libId', libId);
    } catch { /* 隐私模式静默 */ }
    setSelectedLibId(libId);
  }, []);

  // Per-sentence reset on currentIndex change.
  useEffect(() => {
    if (sentences.length > 0 && sentences[currentIndex]) {
      const words = sentences[currentIndex].text.split(/\s+/);
      setUserInputs(new Array(words.length).fill(''));
      setWordResults(new Array(words.length).fill(false));
      setCurrentWordIndex(0);
      inputRefs.current = [];
      setSentenceStartTime(Date.now());
      if (compositionTimerRef.current) {
        clearTimeout(compositionTimerRef.current);
        compositionTimerRef.current = null;
      }
      isComposingRef.current = false;
    }
  }, [sentences, currentIndex]);

  // Autoplay — DESIGN.md v2d: when advancing to a new sentence, fire playAudio.
  // Controlled by `autoPlay` state (toggle in SunkenShortcutBar). Default on;
  // when off, user must press Space to play. The .catch(() => {}) silently
  // absorbs the browser's autoplay-policy rejection on the first call (no user
  // gesture yet) — it starts working after the first manual replay (Space).
  useEffect(() => {
    if (!sentences[currentIndex] || loading) return;
    if (!autoPlay) return;
    const t = setTimeout(() => {
      playAudioInternal();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, sentences, loading, autoPlay]);

  // Persist autoPlay preference. Privacy-mode failure is silently swallowed
  // (same pattern as handlePickerChange's localStorage.setItem).
  useEffect(() => {
    try {
      window.localStorage.setItem('prefs.autoPlay', String(autoPlay));
    } catch { /* 隐私模式静默 */ }
  }, [autoPlay]);

  // Focus the hidden typewriter input on sentence load / index change.
  useEffect(() => {
    if (sentences.length > 0) {
      const timer = setTimeout(() => inputRefs.current[0]?.focus(), 500);
      return () => clearTimeout(timer);
    }
  }, [sentences.length, currentIndex]);

  // 兜底焦点续命：document 捕获阶段监听 click
  // ——即使按钮 / cell onClick 调用 e.stopPropagation() 阻断冒泡，捕获阶段也会先于 target 触发，
  //   把焦点强制续回 typewriter-input，跳过文本输入框 / 打开中的菜单避免抢焦点。
  useEffect(() => {
    const refocus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input:not(.typewriter-input), textarea, [contenteditable="true"]')) return;
      if (target.closest('[role="menu"], [role="listbox"]')) return;
      inputRefs.current[0]?.focus();
    };
    document.addEventListener('click', refocus, true);
    return () => document.removeEventListener('click', refocus, true);
  }, []);

  // Global keyboard handler — DESIGN.md v2d shortcut set.
  //   Space           → Play / Pause audio (replay / pause current sentence)
  //   Tab             → Next cell
  //   Shift + Tab     → Previous cell
  //   /               → Peek current cell answer (held = shown, released = hidden)
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
        const expected = currentSentence?.text.split(/\s+/) ?? [];
        if (e.shiftKey) {
          if (currentWordIndex > 0) setCurrentWordIndex(currentWordIndex - 1);
        } else {
          if (currentWordIndex < expected.length - 1) setCurrentWordIndex(currentWordIndex + 1);
        }
        inputRefs.current[0]?.focus();
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
  }, [currentWordIndex, currentSentence]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Cell typing ----
  const handleWordChange = (index: number, value: string) => {
    // IME composition 期间：onChange 的 value 是临时拼音，不写入 state
    if (isComposingRef.current) {
      return;
    }

    const newInputs = [...userInputs];
    newInputs[index] = value;
    setUserInputs(newInputs);

    const expectedWords = currentSentence.text.split(/\s+/);
    const expected = expectedWords[index]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
    const input = value.toLowerCase().replace(/[.,!?;:'"]/g, '');

    const isWordCorrect = input === expected;
    const newResults = [...wordResults];
    newResults[index] = isWordCorrect;
    setWordResults(newResults);

    if (isWordCorrect) {
      // Auto-complete with correct case
      newInputs[index] = expectedWords[index];
      setUserInputs(newInputs);

      if (index < expectedWords.length - 1) {
        setCurrentWordIndex(index + 1);
      } else {
        // Last cell correct → auto-submit (setSentenceResults + advance)
        setTimeout(() => {
          const fullInput = newInputs.join(' ');
          if (fullInput.trim()) {
            const correct = isAnswerCorrect(sentences[currentIndex], fullInput);
            setSentenceResults(prev => {
              const next = [...prev];
              next[currentIndex] = correct;
              return next;
            });
            if (correct) {
              playCorrectChime();
              setScore(prev => ({ ...prev, correct: prev.correct + 1 }));
              if (currentIndex < sentences.length - 1) {
                setCurrentIndex(currentIndex + 1);
              } else {
                setShowScore(true);
              }
            }
          }
        }, 300);
      }
    }
  };

  // Typewriter onKeyDown: only IME housekeeping + preventDefault for keys
  // that would otherwise leak into the hidden input. All semantic handling
  // (Space / Tab / /) is done in the global keydown handler above.
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
    if (!sentences[currentIndex]?.text) return;
    const audioUrl = sentences[currentIndex]?.audio_url;
    if (!audioUrl) return;
    const fullUrl = getAudioUrl(audioUrl);
    if (audioRef.current) {
      audioRef.current.src = fullUrl;
      audioRef.current.play().catch(() => {});
    }
  }, [sentences, currentIndex]);

  // 答对提示音：C 大调三音连奏上行 E5 → G5 → C6（Web Audio API 程序化生成，零依赖）
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

  // 按键音效：双音反馈 —— 正确=清脆"嘀"(三角波/高频/短),错误=沉重"咚"(正弦/低频/稍长/稍大声)。
  // 设计目标:形成 tap → chime 的层次,既给即时反馈又不抢单词完成的庆祝音。
  // 节流 35ms:防止按住键自动重复时蜂鸣成片(浏览器 input 自动重复间隔 ≈ 30ms)。
  // peak gain: -28dB ≈ 0.04(正确),-24dB ≈ 0.063(错误) —— 后者稍大声以警示。
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

  // 按键音触发：监听 active cell 输入长度变化,只在**新增字符**时发声。
  // - prevTapRef 追踪 (wordIdx, len),切换 cell 时重置基准长度(避免误触发)。
  // - 只比较最后一个字符:符合"按一个键出一个音"的物理直觉。
  // - backspace(长度减少)不触发 —— 视觉删除线即足。
  // - IME 组成期间 handleWordChange 直接 return,不会污染 userInputs → 自动跳过 IME 路径。
  // - auto-complete(单词完成时大小写还原)长度不变,不会重复发声;真正触发是用户最后敲下的那个字符。
  const prevTapRef = useRef<{ wordIdx: number; len: number }>({ wordIdx: -1, len: 0 });
  useEffect(() => {
    const currentInput = userInputs[currentWordIndex] || '';
    const expectedWords = currentSentence?.text.split(/\s+/) ?? [];
    const expectedWord = expectedWords[currentWordIndex] || '';
    const prev = prevTapRef.current;

    // 切换 cell → 重置基准,本次不触发(避免从 N 长直接跳到新 cell 的 0 长被误判)
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
  }, [userInputs, currentWordIndex, currentSentence, playKeyTap]);

  const handleTogglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      playAudioInternal();
    } else {
      audioRef.current.pause();
    }
  }, [playAudioInternal]);

  const handleContainerClick = () => {
    inputRefs.current[0]?.focus();
  };

  // ---- Render ----
  if (loading) {
    return (
      <div className="practice practice--loading">
        <div className="practice__loader" aria-hidden>
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  if (error && sentences.length === 0) {
    return (
      <div className="practice practice--error">
        <p className="practice__error-text">{error}</p>
      </div>
    );
  }

  if (showScore) {
    return (
      <div className="practice">
        <div className="score">
          {/* 円相 — the enso brand mark, drawn once on mount. The only place
              where the reserved --accent color appears. */}
          <svg className="score__enso" viewBox="0 0 100 100" aria-hidden>
            <circle
              cx="50" cy="50" r="42"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray="240 28"
              transform="rotate(-30 50 50)"
            />
          </svg>
          <h2 className="score__title">
            {score.correct} / {score.total}
          </h2>
          <p className="score__text">
            {score.correct === score.total
              ? 'a complete breath.'
              : score.correct === 0
                ? 'the beginning of attention.'
                : `${score.correct} of ${score.total} — quiet progress.`}
          </p>
          <button className="score__again" onClick={() => {
            setShowScore(false);
            setCurrentIndex(0);
            setScore({ correct: 0, total: sentences.length });
            setSentenceResults([]);
            initPractice();
          }}>
            begin again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="practice"
      onClick={handleContainerClick}
    >
      <audio ref={audioRef} />

      <div className="practice__content">
        <header className="masthead" aria-label="page header">
          <h1 className="masthead__brand">dictation.</h1>
          <p className="masthead__sub">
            {String(currentIndex + 1).padStart(2, '0')} / {String(sentences.length).padStart(2, '0')}
          </p>
        </header>

        {/* Library picker — the only navigation control. */}
        {selectedLibId && (
          <div className="practice__library">
            <LibraryPicker
              selectedLibId={selectedLibId}
              onChange={handlePickerChange}
              disabled={loading}
            />
          </div>
        )}

        {currentSentence && (
          <>
            {/* Sentence — hint + cells (the work area) */}
            <div className="sentence">
              <p className="sentence__hint" lang="zh-CN">
                {currentSentence.chinese_text || 'Listen and type the sentence'}
              </p>

              <div
                className="sentence__display"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRefs.current[0]?.focus();
                }}
              >
                <div className="sentence__cells">
                  {currentSentence.text.split(/\s+/).map((word, index) => {
                    const isCorrectWord = wordResults[index];
                    const isActive = currentWordIndex === index;
                    const input = userInputs[index] || '';
                    // DESIGN.md v2d: peek = show the correct word in the active
                    // cell while `/` is held (transient reveal).
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

              {/* Hidden input — captures keystrokes; visual is in the cells. */}
              <input
                ref={el => { inputRefs.current[0] = el; }}
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

            {/* Sunken shortcut bar — always expanded, inline below audio.
                The autoPlay toggle row is appended when `autoPlay` is set. */}
            <SunkenShortcutBar
              autoPlay={{ active: autoPlay, onToggle: () => setAutoPlay((p) => !p) }}
            />

            {/* Progress stepper — last visual element above bottom padding. */}
            <div className="progress" role="list" aria-label="题目进度">
              {sentences.map((_, i) => {
                const result = sentenceResults[i];
                const doneClass = i < currentIndex
                  ? (result === true
                      ? 'progress__dot--correct'
                      : result === false
                        ? 'progress__dot--incorrect'
                        : 'progress__dot--done')
                  : '';
                return (
                  <span
                    key={i}
                    className={
                      'progress__dot' +
                      (doneClass ? ' ' + doneClass : '') +
                      (i === currentIndex ? ' progress__dot--current' : '')
                    }
                    role="listitem"
                    aria-label={
                      i === currentIndex
                        ? `第 ${i + 1} 题（当前）`
                        : result === true
                          ? `第 ${i + 1} 题（答对）`
                          : result === false
                            ? `第 ${i + 1} 题（答错）`
                            : `第 ${i + 1} 题`
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
