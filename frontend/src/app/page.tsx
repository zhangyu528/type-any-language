'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateSentences, getAudioUrl, getPhonetics, Sentence, getContentCatalog } from './api';
import AudioPlayerBar from './AudioPlayerBar';
import LibraryPicker from './LibraryPicker';

// 输入模式枚举 + 元数据：未来加模式只改 INPUT_MODES 和 MODE_METADATA 两处
const INPUT_MODES = ['linear', 'free'] as const;
type InputMode = (typeof INPUT_MODES)[number];

const MODE_METADATA: Record<InputMode, { label: string; icon: string; desc: string }> = {
  linear: { label: '按序输入', icon: '▤', desc: '按听到的顺序依次填写' },
  free:   { label: '自由点选', icon: '⤢', desc: '可任意切换 cell 输入' },
};

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
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [spaceHintActive, setSpaceHintActive] = useState(false);
  const [justErred, setJustErred] = useState(false);
  const [sentenceResults, setSentenceResults] = useState<(boolean | null)[]>([]);
  const [sentenceStartTime, setSentenceStartTime] = useState<number>(Date.now());
  const [showPhonetics, setShowPhonetics] = useState(false);
  const [showSentence, setShowSentence] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [correctSoundEnabled, setCorrectSoundEnabled] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>('linear');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // LibraryPicker selection. Persisted to localStorage so reload preserves
  // the user's pick. Defaults are resolved after the catalog loads — see
  // the catalog-loaded effect below.
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLUListElement>(null);
  const sentenceSnapshotRef = useRef<{userInputs: string[]; wordResults: boolean[]} | null>(null);
  const phoneticsMap = useRef<Record<string, string>>({});
  const showPhoneticsRef = useRef(false);
  const [phoneticsVersion, setPhoneticsVersion] = useState(0);
  // IME 中文输入法状态：composition 期间不污染 userInputs，避免 IME 半挂起导致 Backspace 失效
  const isComposingRef = useRef(false);
  // IME 半挂起兜底：macOS Enter 静默丢弃拼音不触发 compositionend，3 秒后强制 reset
  const compositionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const SPEED_OPTIONS = [0.5, 1, 2] as const;
  type Speed = (typeof SPEED_OPTIONS)[number];
  const [speed, setSpeed] = useState<Speed>(() => {
    if (typeof window === 'undefined') return 1;
    const saved = window.localStorage.getItem('aplayer.speed');
    const n = saved ? Number(saved) : 1;
    return (SPEED_OPTIONS as readonly number[]).includes(n) ? (n as Speed) : 1;
  });

  useEffect(() => {
    initPractice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLibId, selectedDifficulty]);

  // Load the catalog once on mount, then resolve picker selection:
  //   - restored from localStorage if still valid
  //   - else: first lib + catalog's default difficulty
  // The initPractice effect above fires once these land.
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
        const savedDifficulty = (() => {
          try { return window.localStorage.getItem('prefs.difficulty'); } catch { return null; }
        })();

        const lib = catalog.libs.find((l) => l.id === savedLibId) ?? catalog.libs[0];
        const availableDiffs =
          catalog.difficulties_by_lib[lib.level] ?? [catalog.defaults.difficulty];
        const difficulty = availableDiffs.includes(savedDifficulty ?? '')
          ? (savedDifficulty as string)
          : availableDiffs.includes(catalog.defaults.difficulty)
            ? catalog.defaults.difficulty
            : availableDiffs[0];

        setSelectedLibId(lib.id);
        setSelectedDifficulty(difficulty);
      } catch {
        // initPractice will surface the error in its own try/catch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const initPractice = async () => {
    // Skip until the picker has resolved a real selection.
    if (!selectedLibId || !selectedDifficulty) return;
    setLoading(true);
    setError('');
    try {
      const sentences = await generateSentences(selectedLibId, 10, selectedDifficulty);
      setSentences(sentences);
      setCurrentIndex(0);
      setScore({ correct: 0, total: sentences.length });
      setSentenceResults(new Array(sentences.length).fill(null));
      setSentenceStartTime(Date.now());
    } catch (err) {
      setError('Failed to load practice');
    } finally {
      setLoading(false);
    }
  };

  // LibraryPicker callback. Persists to localStorage and re-triggers
  // initPractice via the [selectedLibId, selectedDifficulty] effect.
  const handlePickerChange = useCallback((libId: string, difficulty: string) => {
    try {
      window.localStorage.setItem('prefs.libId', libId);
      window.localStorage.setItem('prefs.difficulty', difficulty);
    } catch { /* 隐私模式静默 */ }
    setSelectedLibId(libId);
    setSelectedDifficulty(difficulty);
  }, []);

  useEffect(() => {
    if (sentences.length > 0 && sentences[currentIndex]) {
      const words = sentences[currentIndex].text.split(/\s+/);
      setUserInputs(new Array(words.length).fill(''));
      setWordResults(new Array(words.length).fill(false));
      setCurrentWordIndex(0);
      setIsCorrect(null);
      setCorrectAnswer('');
      inputRefs.current = [];
      setShowNav(false);
      setShowScore(false);
      setSpaceHintActive(false);
      setShowSentence(false);
      sentenceSnapshotRef.current = null;
      setSentenceStartTime(Date.now());
      // IME 兜底 timer 也清掉，避免句子间状态污染
      if (compositionTimerRef.current) {
        clearTimeout(compositionTimerRef.current);
        compositionTimerRef.current = null;
      }
      isComposingRef.current = false;
    }
  }, [sentences, currentIndex]);

  useEffect(() => {
    setIsPlaying(false);
  }, [currentIndex]);

  // 持久化倍速
  useEffect(() => {
    try {
      window.localStorage.setItem('aplayer.speed', String(speed));
    } catch {
      /* localStorage 满 / 隐私模式：静默忽略 */
    }
  }, [speed]);

  // speed 变化时同步到 audio 元素（不重置 src / currentTime，不打断播放）
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // 快捷键面板折叠状态：启动时从 localStorage 读
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('prefs.shortcutsOpen');
      if (saved === 'true') setShortcutsOpen(true);
    } catch {
      /* 隐私模式静默 */
    }
  }, []);

  // 持久化折叠状态
  useEffect(() => {
    try {
      window.localStorage.setItem('prefs.shortcutsOpen', String(shortcutsOpen));
    } catch {
      /* 静默 */
    }
  }, [shortcutsOpen]);

  // 答对提示音偏好：启动时从 localStorage 读
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('prefs.correctSound');
      if (saved === 'false') setCorrectSoundEnabled(false);
    } catch {
      /* 隐私模式静默 */
    }
  }, []);

  // 持久化答对提示音开关
  useEffect(() => {
    try {
      window.localStorage.setItem('prefs.correctSound', String(correctSoundEnabled));
    } catch {
      /* 静默 */
    }
  }, [correctSoundEnabled]);

  // 输入模式：启动时从 localStorage 读
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('prefs.inputMode');
      if (saved === 'free') setInputMode('free');
    } catch {
      /* 隐私模式静默 */
    }
  }, []);

  // 持久化输入模式
  useEffect(() => {
    try {
      window.localStorage.setItem('prefs.inputMode', inputMode);
    } catch {
      /* 静默 */
    }
  }, [inputMode]);

  // 输入模式弹层：点击外部 / Esc 关闭
  useEffect(() => {
    if (!modeMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (modeBtnRef.current?.contains(e.target as Node)) return;
      if (modeMenuRef.current?.contains(e.target as Node)) return;
      setModeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModeMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [modeMenuOpen]);

  // 点击 panel 外关闭
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const panel = document.getElementById('shortcuts-panel');
      const toggle = document.querySelector('.shortcuts-toggle');
      if (panel?.contains(e.target as Node)) return;
      if (toggle?.contains(e.target as Node)) return;
      setShortcutsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [shortcutsOpen]);

  // Focus first input when sentences first load
  useEffect(() => {
    if (sentences.length > 0) {
      // Delay to ensure input is rendered
      const timer = setTimeout(() => {
        if (inputRefs.current[0]) {
          inputRefs.current[0].focus();
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [sentences.length, currentIndex]);

  // Also try to focus when currentWordIndex becomes 0 (after sentence load)
  useEffect(() => {
    if (isCorrect === null && inputRefs.current[0]) {
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    }
  }, [currentWordIndex, isCorrect, currentIndex]);

  // Audio playback on user interaction only (browsers block auto-play without user gesture)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 优先级 1：panel 打开时按 Esc 关闭 panel（不打开得分）
      if (e.key === 'Escape' && shortcutsOpen) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }
      if (e.key === 'Escape') {
        setShowScore(true);
      }
      // Tab: toggle answer hint
      if (e.key === 'Tab') {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' && isCorrect === null) {
          e.preventDefault();
          setSpaceHintActive(prev => !prev);
        }
      }
      // Shift+S: toggle sentence display
      if (e.key === 'S' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        handleShowSentenceChange(!showSentence);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCorrect, showSentence, shortcutsOpen]);

  const handleWordChange = (index: number, value: string) => {
    // IME composition 期间：onChange 的 value 是临时拼音，不写入 state
    if (isComposingRef.current) {
      return;
    }

    if (spaceHintActive && value.length > 0) {
      setSpaceHintActive(false);
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
        if (inputMode === 'linear') {
          setCurrentWordIndex(index + 1);
        }
        // 自由模式：不跳，保持当前
      } else {
        // All words filled correctly - auto submit
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
              // 答对立即切下一题（不显示 feedback、不延时）
              if (currentIndex < sentences.length - 1) {
                setCurrentIndex(currentIndex + 1);
              } else {
                setShowScore(true);
              }
            } else {
              // 答错：显示 feedback，等用户按 Next
              setIsCorrect(false);
              setCorrectAnswer(sentences[currentIndex].text);
            }
          }
        }, 300);
      }
    }
  };

  const handleWordKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      if (!wordResults[index] && isCorrect === null) {
        setSpaceHintActive(prev => !prev);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!wordResults[index]) return;
      const expectedWords = currentSentence.text.split(/\s+/);
      if (index < expectedWords.length - 1 && inputMode === 'linear') {
        setCurrentWordIndex(index + 1);
        inputRefs.current[0]?.focus();
      }
    } else if (e.key === 'Enter') {
      const expectedWords = currentSentence.text.split(/\s+/);
      if (index === expectedWords.length - 1) {
        handleSubmit();
      }
    }
  };

  const handleTypewriterKeyDown = (e: React.KeyboardEvent) => {
    // IME composition 期间：让 IME 独占处理（Enter = 选词、Backspace = 删拼音...）
    // React keydown 此时是噪音，统一不响应，避免 IME 半挂起
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    // macOS IME 半挂起兜底：第一个非 composition 键 = 立即脱困
    // （macOS 中文拼音 Enter 静默丢弃拼音不触发 compositionend，ref 卡在 true）
    if (isComposingRef.current) {
      isComposingRef.current = false;
      if (compositionTimerRef.current) {
        clearTimeout(compositionTimerRef.current);
        compositionTimerRef.current = null;
      }
    }

    // 自由模式：Tab 切下一 cell、Shift+Tab 切上一 cell
    if (inputMode === 'free' && e.key === 'Tab') {
      e.preventDefault();
      const expectedWords = currentSentence?.text.split(/\s+/) || [];
      if (e.shiftKey) {
        if (currentWordIndex > 0) setCurrentWordIndex(currentWordIndex - 1);
      } else {
        if (currentWordIndex < expectedWords.length - 1) {
          setCurrentWordIndex(currentWordIndex + 1);
        }
      }
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      const expectedWords = currentSentence.text.split(/\s+/);
      const isLast = currentWordIndex === expectedWords.length - 1;
      const currentWord = expectedWords[currentWordIndex];
      const target = currentWord?.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const input = userInputs[currentWordIndex]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const isCorrectCell = input && input === target;
      const isComplete = input && input.length === target?.length;

      if (!input) {
        // 空 input：明确"跳过"意图，直接跳下一 cell
        if (!isLast) setCurrentWordIndex(currentWordIndex + 1);
        return;
      }

      if (!isComplete) {
        // 中间输入中：静默不响应（避免误跳）
        return;
      }

      if (isCorrectCell && isLast) {
        // 完整 + 答对 + 末位：提交
        handleSubmit();
      } else if (isCorrectCell && inputMode === 'free') {
        // 完整 + 答对 + 自由非末位：跳下一 cell
        setCurrentWordIndex(currentWordIndex + 1);
      } else {
        // 完整 + 答错：震动
        setJustErred(true);
        setTimeout(() => setJustErred(false), 300);
      }
      return;
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      // Close hint when user starts typing
      if (spaceHintActive) {
        setSpaceHintActive(false);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const expectedWords = currentSentence.text.split(/\s+/);
      const isLast = currentWordIndex === expectedWords.length - 1;
      const currentWord = expectedWords[currentWordIndex]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const input = userInputs[currentWordIndex]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const isCorrectCell = input && input === currentWord;

      if (isLast && isCorrectCell) {
        // 末位 + 答对：提交
        handleSubmit();
      } else if (!isLast) {
        // 中间 cell：不论对错都跳下一 cell（"我不会"用）
        setCurrentWordIndex(currentWordIndex + 1);
      }
      // 末位 + 答错/未完成：静默
    }
  };

  const handleSubmit = async () => {
    const fullInput = userInputs.join(' ');
    if (!fullInput.trim()) return;

    try {
      const correct = isAnswerCorrect(sentences[currentIndex], fullInput);
      setSentenceResults(prev => {
        const next = [...prev];
        next[currentIndex] = correct;
        return next;
      });

      if (correct) {
        playCorrectChime();
        setScore(prev => ({ ...prev, correct: prev.correct + 1 }));
        // 答对立即切下一题
        if (currentIndex < sentences.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else {
          setShowScore(true);
        }
      } else {
        setIsCorrect(false);
        setCorrectAnswer(sentences[currentIndex].text);
      }
    } catch (err) {
      setError('Check failed');
    }
  };

  const playAudio = useCallback(() => {
    if (!sentences[currentIndex]?.text) return;

    const audioUrl = sentences[currentIndex]?.audio_url;
    if (!audioUrl) return;

    const fullUrl = getAudioUrl(audioUrl);
    if (audioRef.current) {
      audioRef.current.src = fullUrl;
      audioRef.current.playbackRate = speed;
      audioRef.current.play().catch(() => {});
    }
  }, [sentences, currentIndex, speed]);

  // 答对提示音：C 大调三音连奏上行 E5 → G5 → C6（Web Audio API 程序化生成，零依赖）
  const playCorrectChime = useCallback(() => {
    if (!correctSoundEnabled) return;

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
  }, [correctSoundEnabled]);

  const handleTogglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      playAudio();
    } else {
      audioRef.current.pause();
    }
  }, [playAudio]);

  const handleSpeedChange = useCallback((next: number) => {
    const safe: Speed = (SPEED_OPTIONS as readonly number[]).includes(next) ? (next as Speed) : 1;
    setSpeed(safe);
    // 立即同步到 audio 元素（不等 React effect 排队，避免体感延迟）
    if (audioRef.current) {
      audioRef.current.playbackRate = safe;
    }
  }, []);

  const handleToggleLoop = useCallback(() => {
    setIsLooping((prev) => !prev);
  }, []);

  const handleNext = () => {
    if (currentIndex < sentences.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setShowScore(true);
    }
    resetNavTimeout();
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
    resetNavTimeout();
  };

  const resetNavTimeout = () => {
    setShowNav(true);
    if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    navTimeoutRef.current = setTimeout(() => setShowNav(false), 2000);
  };

  const handleContainerClick = () => {
    resetNavTimeout();
    inputRefs.current[0]?.focus();
  };

  // Close dropdowns when clicking outside the toolbar
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setIsOptionsOpen(false);
        setIsToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSettings = () => {
    setIsToolsOpen(false);
    alert('设置功能待实现');
  };

  const handleTheme = () => {
    setIsToolsOpen(false);
    alert('主题切换待实现');
  };

  const handleTour = () => {
    setIsToolsOpen(false);
    alert('功能引导待实现');
  };

  const handleShowSentenceChange = (checked: boolean) => {
    if (!currentSentence) return;
    if (checked) {
      // 保存当前状态，以便取消时恢复
      sentenceSnapshotRef.current = {
        userInputs: [...userInputs],
        wordResults: [...wordResults],
      };
      // 显示完整正确答案
      const words = currentSentence.text.split(/\s+/);
      setUserInputs([...words]);
      setWordResults(new Array(words.length).fill(true));
    } else {
      // 从 snapshot 恢复到"上一个正确单词之后"的状态
      const snap = sentenceSnapshotRef.current;
      if (snap) {
        const words = currentSentence.text.split(/\s+/);

        // 找到最后一个连续正确的单词
        let lastCorrect = -1;
        for (let i = 0; i < snap.wordResults.length; i++) {
          if (snap.wordResults[i]) lastCorrect = i;
          else break;
        }

        // 恢复输入：保留已正确输入的，清空后续
        const newInputs: string[] = new Array(words.length).fill('');
        for (let i = 0; i <= lastCorrect; i++) {
          newInputs[i] = snap.userInputs[i] || words[i];
        }

        setUserInputs(newInputs);
        setWordResults(new Array(words.length).fill(false).map((_, i) => i <= lastCorrect));
        setCurrentWordIndex(Math.min(lastCorrect + 1, words.length - 1));
      }
    }
    setShowSentence(checked);
  };

  const handleShowPhoneticsChange = async (checked: boolean) => {
    setShowPhonetics(checked);
    showPhoneticsRef.current = checked;
    if (checked) {
      await loadPhonetics();
    }
  };

  const currentSentence = sentences[currentIndex];

  const loadPhonetics = useCallback(async () => {
    if (!currentSentence) return;
    const allWords = currentSentence.text.split(/\s+/).map(w => w.toLowerCase().replace(/[^a-zA-Z0-9']/g, '')).filter(Boolean);
    const unique = Array.from(new Set(allWords));
    const missing = unique.filter(w => !phoneticsMap.current[w]);
    if (missing.length === 0) {
      setPhoneticsVersion(v => v + 1);
      return;
    }
    try {
      const result = await getPhonetics(missing);
      phoneticsMap.current = { ...phoneticsMap.current, ...result };
      setPhoneticsVersion(v => v + 1);
    } catch (err) {
      console.error('Failed to load phonetics:', err);
    }
  }, [currentSentence]);
  const allWordsFilled = userInputs.every((inp, i) => {
    const expected = currentSentence?.text.split(/\s+/)[i]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
    const actual = inp.toLowerCase().replace(/[.,!?;:'"]/g, '');
    return actual === expected;
  });

  // 当句子切换或 phonetics 开关为开时，自动加载音标
  useEffect(() => {
    if (showPhoneticsRef.current) {
      loadPhonetics();
    }
  }, [currentIndex, showPhonetics]);

  if (loading) {
    return (
      <div className="immersive-container">
        <div className="immersive-loading">
          <div className="waveform">
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error && sentences.length === 0) {
    return (
      <div className="immersive-container">
        <div className="immersive-error">{error}</div>
      </div>
    );
  }

  if (showScore) {
    return (
      <div className="immersive-container">
        <div className="score-summary">
          <div className="score-summary__icon">{score.correct === score.total ? '🎉' : '📝'}</div>
          <h2 className="score-summary__title">
            {score.correct} / {score.total}
          </h2>
          <p className="score-summary__text">
            {score.correct === score.total
              ? 'Perfect score! Well done!'
              : `${score.correct} correct out of ${score.total}`}
          </p>
          <button className="score-summary__button" onClick={() => {
            setShowScore(false);
            setCurrentIndex(0);
            setScore({ correct: 0, total: sentences.length });
            setSentenceResults([]);
            initPractice();
          }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`immersive-container ${isCorrect === true ? 'feedback-correct' : ''} ${isCorrect === false ? 'feedback-incorrect' : ''}`}
      onClick={handleContainerClick}
    >
      <audio
        ref={audioRef}
        loop={isLooping}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Content selector — picks which vocab lib + difficulty to practice. */}
      {selectedLibId && selectedDifficulty && (
        <div className="library-picker-bar">
          <LibraryPicker
            selectedLibId={selectedLibId}
            selectedDifficulty={selectedDifficulty}
            onChange={handlePickerChange}
            disabled={loading}
          />
        </div>
      )}

      {/* Top-right toolbar */}
      <div
        className="toolbar"
        ref={toolbarRef}
        onKeyDown={(e) => {
          // 阻止键盘事件冒泡到 window listener（避免字母/空格被菜单 checkbox 误捕获）
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
        }}
      >
        {/* 1. 音频播放（UI 已删除，playAudio() 由 AudioPlayerBar 调用，逻辑保留） */}
        {/* 2. 显示选项（UI 已删除，showSentence 仍由 shortcuts-panel 的"显示句子"复选框控制，逻辑保留） */}

        {/* 3. 页面工具 */}
        <div className="toolbar__dropdown">
          <button
            type="button"
            className={`toolbar__btn toolbar__btn--icon ${isToolsOpen ? 'toolbar__btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsToolsOpen(v => !v);
              setIsOptionsOpen(false);
            }}
            aria-haspopup="true"
            aria-expanded={isToolsOpen}
            aria-label="页面工具"
            title="页面工具"
          >
            …
          </button>
          {isToolsOpen && (
            <div className="toolbar__menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="toolbar__menu-header">页面工具</div>
              <button type="button" className="toolbar__menu-item" onClick={handleSettings} role="menuitem">设置</button>
              <button type="button" className="toolbar__menu-item" onClick={handleTheme} role="menuitem">主题</button>
              <button type="button" className="toolbar__menu-item" onClick={handleTour} role="menuitem">功能引导</button>
            </div>
          )}
        </div>
      </div>

      {/* 折叠触发器：右下角浮动齿轮按钮 */}
      <button
        type="button"
        className="shortcuts-toggle"
        aria-label={shortcutsOpen ? '关闭快捷键面板' : '打开快捷键面板'}
        aria-expanded={shortcutsOpen}
        aria-controls="shortcuts-panel"
        onClick={() => setShortcutsOpen((v) => !v)}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {shortcutsOpen ? (
            <path d="M6 6 L18 18 M6 18 L18 6" />
          ) : (
            <>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2 L12 5 M12 19 L12 22 M2 12 L5 12 M19 12 L22 12 M4.93 4.93 L7.05 7.05 M16.95 16.95 L19.07 19.07 M4.93 19.07 L7.05 16.95 M16.95 7.05 L19.07 4.93" />
            </>
          )}
        </svg>
      </button>

      {/* 右侧面板：快捷键 + 显示选项 */}
      <aside
        id="shortcuts-panel"
        className={`shortcuts-panel ${shortcutsOpen ? 'is-open' : ''}`}
        aria-label="快捷键和选项"
        aria-hidden={!shortcutsOpen}
      >
        <div className="shortcuts-panel__title">快捷键</div>
        <ul className="shortcuts-panel__list">
          <li><kbd>Space</kbd><span>提交 / 跳过（空时）</span></li>
          <li><kbd>Enter</kbd><span>跳过 / 末位提交</span></li>
          <li><kbd>Tab</kbd><span>下一 cell</span></li>
          <li><kbd>Shift</kbd>+<kbd>Tab</kbd><span>上一 cell</span></li>
          <li><kbd>Shift</kbd>+<kbd>S</kbd><span>显示/隐藏句子</span></li>
          <li><kbd>Esc</kbd><span>查看得分</span></li>
          <li><kbd>←</kbd><kbd>→</kbd><span>上一句/下一句</span></li>
        </ul>

        <div className="shortcuts-panel__divider" />

        <div className="shortcuts-panel__title">显示选项</div>
        <ul className="shortcuts-panel__list">
          <li>
            <label className="shortcuts-panel__check">
              <input
                type="checkbox"
                checked={showSentence}
                onChange={(e) => handleShowSentenceChange(e.target.checked)}
              />
              <span className="shortcuts-panel__checkbox" aria-hidden></span>
              <span>显示句子</span>
            </label>
          </li>
          <li>
            <label className="shortcuts-panel__check">
              <input
                type="checkbox"
                checked={showPhonetics}
                onChange={(e) => handleShowPhoneticsChange(e.target.checked)}
              />
              <span className="shortcuts-panel__checkbox" aria-hidden></span>
              <span>显示音标</span>
            </label>
          </li>
          <li>
            <label className="shortcuts-panel__check">
              <input
                type="checkbox"
                checked={correctSoundEnabled}
                onChange={(e) => setCorrectSoundEnabled(e.target.checked)}
              />
              <span className="shortcuts-panel__checkbox" aria-hidden></span>
              <span>答对提示音</span>
            </label>
          </li>
        </ul>
      </aside>

      <div className="immersive-content">
        {currentSentence && (
          <>
            <AudioPlayerBar
              isPlaying={isPlaying}
              currentIndex={currentIndex}
              totalCount={sentences.length}
              speed={speed}
              onSpeedChange={handleSpeedChange}
              isLooping={isLooping}
              onToggleLoop={handleToggleLoop}
              onPlay={playAudio}
              onTogglePlay={handleTogglePlay}
            />


            <div className="sentence-area" onClick={() => inputRefs.current[0]?.focus()}>
              {/* 输入模式选择器：sentence-area 右上角触发按钮 + 弹层 */}
              <div className="mode-selector">
                <button
                  ref={modeBtnRef}
                  type="button"
                  className="mode-selector__btn"
                  aria-label="选择输入模式"
                  aria-haspopup="listbox"
                  aria-expanded={modeMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModeMenuOpen((v) => !v);
                  }}
                >
                  <span aria-hidden>{MODE_METADATA[inputMode].icon}</span>
                  <span>{MODE_METADATA[inputMode].label}</span>
                  <span className="apb__caret" aria-hidden>▾</span>
                </button>
                {modeMenuOpen && (
                  <ul
                    ref={modeMenuRef}
                    className="mode-selector__menu"
                    role="listbox"
                    aria-label="选择输入模式"
                  >
                    {INPUT_MODES.map((m) => (
                      <li key={m} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={inputMode === m}
                          className={`mode-selector__option ${inputMode === m ? 'is-active' : ''}`}
                          onClick={() => {
                            setInputMode(m);
                            setModeMenuOpen(false);
                          }}
                          title={MODE_METADATA[m].desc}
                        >
                          <span className="mode-selector__option-icon" aria-hidden>{MODE_METADATA[m].icon}</span>
                          <span className="mode-selector__option-body">
                            <span className="mode-selector__option-label">{MODE_METADATA[m].label}</span>
                            <span className="mode-selector__option-desc">{MODE_METADATA[m].desc}</span>
                          </span>
                          {inputMode === m && <span className="mode-selector__option-check" aria-hidden>✓</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="sentence-hint" lang="zh-CN">{currentSentence.chinese_text || 'Listen and type the sentence'}</p>

              <div className="sentence-display typewriter-mode" onClick={(e) => {
                e.stopPropagation();
                inputRefs.current[0]?.focus();
              }}>
                {/* 所有 cell 共享一个 flex 容器，wrap 边界物理同步 */}
                <div className="sentence-line" data-phonetics-version={phoneticsVersion}>
                  {currentSentence.text.split(/\s+/).map((word, index) => {
                    const isCorrectWord = wordResults[index];
                    const isActive = currentWordIndex === index && isCorrect === null;
                    const input = userInputs[index] || '';
                    const wordKey = word.toLowerCase().replace(/[^a-zA-Z0-9']/g, '');
                    const phonetic = showPhonetics ? phoneticsMap.current[wordKey] || '' : '';

                    return (
                      <span key={`cell-${index}`} className="sentence-cell">
                        {/* 单词行（带下划线） */}
                        <span
                          className={`line-word ${isCorrectWord ? 'line-word--correct' : ''} ${isActive ? 'line-word--active' : ''} ${inputMode === 'free' ? 'line-word--clickable' : ''} ${justErred && isActive ? 'line-word--shake' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (inputMode === 'free' && !isComposingRef.current) {
                              setCurrentWordIndex(index);
                            }
                          }}
                        >
                          <span className="line-word-ghost" aria-hidden>{word}</span>
                          {isCorrectWord ? (
                            <span className="line-word-text">{word}</span>
                          ) : isActive ? (
                            <span className="line-word-input">
                              {input.split('').map((char, i) => {
                                const status = char?.toLowerCase() === word[i]?.toLowerCase() ? 'correct' : 'wrong';
                                return <span key={i} className={`line-char line-char--${status}`}>{char}</span>;
                              })}
                              <span className="line-cursor">|</span>
                            </span>
                          ) : (
                            <span className="line-word-empty"></span>
                          )}
                        </span>

                        {/* 音标行 */}
                        {showPhonetics && (
                          <span className="phonetic-cell">
                            <span className="phonetic-ghost" aria-hidden>{word}</span>
                            {phonetic ? <span className="phonetic-text">{phonetic}</span> : <span className="phonetic-placeholder">·</span>}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Hidden input for typewriter - captures all keystrokes */}
              <input
                ref={el => { inputRefs.current[0] = el; }}
                type="text"
                className="typewriter-input"
                value={userInputs[currentWordIndex] || ''}
                onChange={(e) => handleWordChange(currentWordIndex, e.target.value)}
                onKeyDown={(e) => handleTypewriterKeyDown(e)}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                  // 兜底：macOS IME Enter 静默丢弃拼音不触发 compositionend → 3 秒后强制 reset
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
                  // 用 IME commit 后的最终值同步一次（React 接管 input）
                  const finalValue = (e.target as HTMLInputElement).value;
                  handleWordChange(currentWordIndex, finalValue);
                }}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />

              {/* Answer hint box - only shows when Space pressed */}
              {spaceHintActive && (
                <div className="hint-box">
                  <span className="hint-box__label">Answer:</span>
                  <span className="hint-box__word">
                    {currentSentence.text.split(/\s+/)[currentWordIndex]}
                  </span>
                </div>
              )}

              <div className="progress-dots">
                {sentences.map((_, i) => {
                  const result = sentenceResults[i];
                  const doneClass = i < currentIndex
                    ? (result === true ? 'dot--correct' : result === false ? 'dot--incorrect' : 'dot--done')
                    : '';
                  return (
                    <span
                      key={i}
                      className={`dot ${doneClass} ${i === currentIndex ? 'dot--current' : ''}`}
                    />
                  );
                })}
              </div>
            </div>

            <div className="action-area">
              {isCorrect === null && allWordsFilled && (
                <button className="submit-btn" onClick={handleSubmit}>
                  ✓ Submit
                </button>
              )}

              {isCorrect !== null && (
                <div className={`feedback ${isCorrect ? 'feedback--correct' : 'feedback--incorrect'}`}>
                  <div className="feedback__header">
                    <span className="feedback__title">{isCorrect ? 'Correct!' : 'Incorrect'}</span>
                    <span className="feedback__time">用了 {Math.round((Date.now() - sentenceStartTime) / 1000)}s</span>
                  </div>
                  {!isCorrect && <p className="feedback__answer">{correctAnswer}</p>}
                  <button className="next-btn" onClick={handleNext}>
                    {currentIndex < sentences.length - 1 ? 'Next →' : 'Finish'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <div className={`nav-hint ${showNav ? 'visible' : ''}`}>
          <button onClick={handlePrev} disabled={currentIndex === 0}>← Prev</button>
          <span>Press Esc for score</span>
          <button onClick={handleNext}>Next →</button>
        </div>
      </div>
    </div>
  );
}