'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getVocabularyLibs, generateSentences, checkAnswer, getAudioUrl, getPhonetics, Sentence } from './api';
import AudioPlayerBar from './AudioPlayerBar';

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
  const [showPhonetics, setShowPhonetics] = useState(false);
  const [showSentence, setShowSentence] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sentenceSnapshotRef = useRef<{userInputs: string[]; wordResults: boolean[]} | null>(null);
  const phoneticsMap = useRef<Record<string, string>>({});
  const showPhoneticsRef = useRef(false);
  const [phoneticsVersion, setPhoneticsVersion] = useState(0);

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
  }, []);

  const initPractice = async () => {
    setLoading(true);
    setError('');
    try {
      const libs = await getVocabularyLibs();
      if (libs.length === 0) {
        setError('No vocabulary library available');
        setLoading(false);
        return;
      }
      const data = await generateSentences(libs[0].id, 10, 'beginner');
      setSentences(data.sentences);
      setCurrentIndex(0);
      setScore({ correct: 0, total: data.sentences.length });
    } catch (err) {
      setError('Failed to load practice');
    } finally {
      setLoading(false);
    }
  };

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
      if (e.key === 'Escape') {
        setShowScore(true);
      }
      // Space: play audio
      if (e.key === ' ') {
        e.preventDefault();
        playAudio();
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
  }, [isCorrect, showSentence]);

  const handleWordChange = (index: number, value: string) => {
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

    if (!isWordCorrect && value.length > 0) {
      // Trigger error feedback
      setJustErred(true);
      setTimeout(() => setJustErred(false), 300);
    }

    if (isWordCorrect) {
      // Auto-complete with correct case
      newInputs[index] = expectedWords[index];
      setUserInputs(newInputs);

      if (index < expectedWords.length - 1) {
        setCurrentWordIndex(index + 1);
      } else {
        // All words filled correctly - auto submit
        setTimeout(() => {
          const fullInput = newInputs.join(' ');
          if (fullInput.trim()) {
            checkAnswer(sentences[currentIndex].id, fullInput).then(result => {
              setIsCorrect(result.is_correct);
              setCorrectAnswer(result.correct_answer);
              if (result.is_correct) {
                setScore(prev => ({ ...prev, correct: prev.correct + 1 }));
              }
              // Move to next question after a short delay
              setTimeout(() => {
                if (currentIndex < sentences.length - 1) {
                  setCurrentIndex(currentIndex + 1);
                } else {
                  setShowScore(true);
                }
              }, 1000);
            });
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
      if (index < expectedWords.length - 1) {
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
    if (e.key === ' ') {
      e.preventDefault();
      playAudio();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      // Close hint when user starts typing
      if (spaceHintActive) {
        setSpaceHintActive(false);
      }
    } else if (e.key === 'Enter') {
      const expectedWords = currentSentence.text.split(/\s+/);
      const currentWord = expectedWords[currentWordIndex]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const input = userInputs[currentWordIndex]?.toLowerCase().replace(/[.,!?;:'"]/g, '');

      if (input === currentWord) {
        // Auto-complete with correct case
        const newInputs = [...userInputs];
        newInputs[currentWordIndex] = expectedWords[currentWordIndex];
        setUserInputs(newInputs);

        if (currentWordIndex < expectedWords.length - 1) {
          setCurrentWordIndex(currentWordIndex + 1);
        } else {
          handleSubmit();
        }
      }
    }
  };

  const handleSubmit = async () => {
    const fullInput = userInputs.join(' ');
    if (!fullInput.trim()) return;

    try {
      const result = await checkAnswer(sentences[currentIndex].id, fullInput);
      setIsCorrect(result.is_correct);
      setCorrectAnswer(result.correct_answer);

      if (result.is_correct) {
        setScore(prev => ({ ...prev, correct: prev.correct + 1 }));
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
        {/* 1. 音频播放 */}
        <button
          type="button"
          className="toolbar__btn"
          onClick={(e) => { e.stopPropagation(); playAudio(); }}
          title="播放音频"
        >
          <span className="toolbar__icon" aria-hidden>🔊</span>
          <span>音频播放</span>
        </button>

        {/* 2. 显示选项 */}
        <div className="toolbar__dropdown">
          <button
            type="button"
            className={`toolbar__btn ${isOptionsOpen ? 'toolbar__btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsOptionsOpen(v => !v);
              setIsToolsOpen(false);
            }}
            aria-haspopup="true"
            aria-expanded={isOptionsOpen}
          >
            <span>显示选项</span>
            <span className="toolbar__caret" aria-hidden>▾</span>
          </button>
          {isOptionsOpen && (
            <div className="toolbar__menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="toolbar__menu-header">显示选项</div>
              <label className="toolbar__menu-item toolbar__menu-item--check">
                <input
                  type="checkbox"
                  checked={showSentence}
                  onChange={(e) => handleShowSentenceChange(e.target.checked)}
                />
                <span className="toolbar__checkbox" aria-hidden></span>
                <span>显示句子</span>
              </label>
            </div>
          )}
        </div>

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

      {/* 右侧面板：快捷键 + 显示选项 */}
      <aside className="shortcuts-panel" aria-label="快捷键和选项">
        <div className="shortcuts-panel__title">快捷键</div>
        <ul className="shortcuts-panel__list">
          <li><kbd>Space</kbd><span>播放音频</span></li>
          <li><kbd>Tab</kbd><span>显示/隐藏答案</span></li>
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
                checked={showPhonetics}
                onChange={(e) => handleShowPhoneticsChange(e.target.checked)}
              />
              <span className="shortcuts-panel__checkbox" aria-hidden></span>
              <span>显示音标</span>
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
              <p className="sentence-hint">{currentSentence.chinese_text || 'Listen and type the sentence'}</p>

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
                          className={`line-word ${isCorrectWord ? 'line-word--correct' : ''} ${isActive ? 'line-word--active' : ''}`}
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
                ref={el => inputRefs.current[0] = el}
                type="text"
                className="typewriter-input"
                value={userInputs[currentWordIndex] || ''}
                onChange={(e) => handleWordChange(currentWordIndex, e.target.value)}
                onKeyDown={(e) => handleTypewriterKeyDown(e)}
                autoFocus
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
                {sentences.map((_, i) => (
                  <span key={i} className={`dot ${i === currentIndex ? 'dot--current' : ''} ${i < currentIndex ? 'dot--done' : ''}`} />
                ))}
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
                  <span className="feedback__title">{isCorrect ? 'Correct!' : 'Incorrect'}</span>
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