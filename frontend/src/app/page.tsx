'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getVocabularyLibs, generateSentences, checkAnswer, getAudioUrl, VocabularyLib, Sentence } from './api';

// Stats type for localStorage
interface GameStats {
  streak: number;
  xp: number;
  lastPracticeDate: string;
  todayCount: number;
}

const STORAGE_KEY = 'listen_write_stats';

function loadStats(): GameStats {
  if (typeof window === 'undefined') {
    return { streak: 0, xp: 0, lastPracticeDate: '', todayCount: 0 };
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    return JSON.parse(saved);
  }
  return { streak: 0, xp: 0, lastPracticeDate: '', todayCount: 0 };
}

function saveStats(stats: GameStats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export default function PracticePage() {
  const [libs, setLibs] = useState<VocabularyLib[]>([]);
  const [selectedLibId, setSelectedLibId] = useState<string>('');
  const [practiceStarted, setPracticeStarted] = useState(false);
  const [difficulty, setDifficulty] = useState<string>('beginner');
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<boolean[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioPlaysRemaining, setAudioPlaysRemaining] = useState(3);
  const [stats, setStats] = useState<GameStats>({ streak: 0, xp: 0, lastPracticeDate: '', todayCount: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const difficultyOptions = [
    { value: 'beginner', label: '初级', color: '#22C55E' },
    { value: 'cet4', label: '中级', color: '#F59E0B' },
    { value: 'cet6', label: '高级', color: '#EF4444' },
    { value: 'ielts', label: '雅思', color: '#8B5CF6' },
  ];

  // Load stats and libs on mount
  useEffect(() => {
    setStats(loadStats());
    async function loadLibs() {
      try {
        const data = await getVocabularyLibs();
        setLibs(data);
        if (data.length > 0) {
          setSelectedLibId(data[0].id);
        }
      } catch (err) {
        setError('加载词库失败，请确保后端服务已启动');
      }
    }
    loadLibs();
  }, []);

  // Update streak based on date
  useEffect(() => {
    const today = new Date().toDateString();
    const lastDate = stats.lastPracticeDate;

    if (lastDate && lastDate !== today) {
      const lastPractice = new Date(lastDate);
      const todayDate = new Date(today);
      const diffDays = Math.floor((todayDate.getTime() - lastPractice.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Consecutive day
        setStats(prev => ({ ...prev, streak: prev.streak + 1 }));
      } else if (diffDays > 1) {
        // Streak broken
        setStats(prev => ({ ...prev, streak: 1 }));
      }
    } else if (!lastDate) {
      setStats(prev => ({ ...prev, streak: 1 }));
    }
  }, []);

  const handleStart = async () => {
    if (!selectedLibId) return;

    setLoading(true);
    setError('');
    setSentences([]);
    setCurrentIndex(0);
    setUserInputs([]);
    setWordResults([]);
    setCurrentWordIndex(0);
    setIsCorrect(null);
    setAudioPlaysRemaining(3);

    try {
      const data = await generateSentences(selectedLibId, 10, difficulty);
      console.log('Generated sentences:', data);
      setSentences(data.sentences);
      setCurrentIndex(0);
      setPracticeStarted(true);
    } catch (err) {
      console.error('Generate error:', err);
      setError('生成练习失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLibrary = () => {
    setPracticeStarted(false);
    setSentences([]);
    setCurrentIndex(0);
    setUserInputs([]);
    setWordResults([]);
    setIsCorrect(null);
  };

  // Initialize word inputs when sentence changes
  useEffect(() => {
    if (currentSentence && currentSentence.text) {
      const words = currentSentence.text.split(/\s+/);
      setUserInputs(new Array(words.length).fill(''));
      setWordResults(new Array(words.length).fill(false));
      setCurrentWordIndex(0);
      setIsCorrect(null);
      inputRefs.current = [];
    }
  }, [sentences[currentIndex]]);

  // Handle word input change
  const handleWordChange = (index: number, value: string) => {
    const newInputs = [...userInputs];
    newInputs[index] = value;
    setUserInputs(newInputs);

    // Get expected word
    const expectedWords = currentSentence.text.split(/\s+/);
    const expected = expectedWords[index]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
    const input = value.toLowerCase().replace(/[.,!?;:'"]/g, '');

    // Check if word is correct
    const isWordCorrect = input === expected;
    const newResults = [...wordResults];
    newResults[index] = isWordCorrect;
    setWordResults(newResults);

    // Auto-advance to next word if current is correct and not last word
    if (isWordCorrect && index < expectedWords.length - 1) {
      setTimeout(() => {
        setCurrentWordIndex(index + 1);
        inputRefs.current[index + 1]?.focus();
      }, 300);
    }
  };

  // Handle Enter key in word input
  const handleWordKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Read value directly from input element to avoid React state delay
      const inputEl = inputRefs.current[index];
      const inputValue = inputEl?.value?.toLowerCase().replace(/[.,!?;:'"]/g, '') || '';

      const expectedWords = currentSentence.text.split(/\s+/);
      const expected = expectedWords[index]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
      const isCurrentCorrect = inputValue === expected;

      if (isCurrentCorrect && index < expectedWords.length - 1) {
        setCurrentWordIndex(index + 1);
        inputRefs.current[index + 1]?.focus();
      } else if (index === expectedWords.length - 1) {
        // Last word - check full answer
        handleSubmit();
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
        const today = new Date().toDateString();
        setStats(prev => {
          const newStats = {
            ...prev,
            xp: prev.xp + 10,
            lastPracticeDate: today,
            todayCount: prev.lastPracticeDate === today ? prev.todayCount + 1 : 1,
          };
          saveStats(newStats);
          return newStats;
        });
      }
    } catch (err) {
      setError('校验答案失败');
    }
  };

  const playAudio = useCallback(() => {
    if (!sentences[currentIndex]?.audio_url || audioPlaysRemaining <= 0) return;

    const audioUrl = getAudioUrl(sentences[currentIndex].audio_url!);

    if (audioRef.current) {
      audioRef.current.pause();
    }

    audioRef.current = new Audio(audioUrl);
    audioRef.current.onplay = () => setIsPlaying(true);
    audioRef.current.onended = () => {
      setIsPlaying(false);
      setAudioPlaysRemaining(prev => prev - 1);
    };
    audioRef.current.onerror = () => {
      setIsPlaying(false);
      setError('音频播放失败');
    };
    audioRef.current.play();
  }, [sentences, currentIndex, audioPlaysRemaining]);

  const handleNext = () => {
    if (currentIndex < sentences.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setUserInputs([]);
      setWordResults([]);
      setCurrentWordIndex(0);
      setIsCorrect(null);
      setCorrectAnswer('');
      setAudioPlaysRemaining(3);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setUserInputs([]);
      setWordResults([]);
      setCurrentWordIndex(0);
      setIsCorrect(null);
      setCorrectAnswer('');
      setAudioPlaysRemaining(3);
    }
  };

  const currentSentence = sentences[currentIndex];
  const showNavigation = sentences.length > 0;
  const todayProgress = stats.todayCount;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__logo">
          <h1>听音写句</h1>
        </div>
        <div className="app-header__stats">
          <div className="stat-item">
            <span className="stat-item__icon">🔥</span>
            <span className="stat-item__value">{stats.streak}</span>
          </div>
          <div className="stat-item">
            <span className="stat-item__icon">⭐</span>
            <span className="stat-item__value">{stats.xp} XP</span>
          </div>
        </div>
        <div className="app-header__actions">
          <button className="action-button" title="设置">⚙️</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        <div className="practice-page">
          {error && (
            <div className="error">
              <span className="error__icon">⚠️</span>
              {error}
            </div>
          )}

          {!practiceStarted ? (
            /* ========== Library Selection View ========== */
            <>
              {/* Header Section */}
              <div className="main-header">
                <div className="main-header__title">
                  <span className="main-header__icon">🎧</span>
                  <h2>听音写句</h2>
                </div>
                <p className="main-header__subtitle">选择词库，开始你的英语学习之旅</p>
              </div>

              {/* Difficulty Selector */}
              <div className="difficulty-selector">
                <label className="difficulty-selector__label">选择难度</label>
                <div className="difficulty-options">
                  {difficultyOptions.map((opt) => (
                    <button
                      key={opt.value}
                      className={`difficulty-option ${difficulty === opt.value ? 'difficulty-option--selected' : ''}`}
                      onClick={() => setDifficulty(opt.value)}
                      style={{ '--difficulty-color': opt.color } as React.CSSProperties}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Library Cards */}
              <div className="library-cards">
                {libs.map((lib) => {
                  const cardColors = {
                    beginner: { color: '#22C55E', light: '#4ADE80' },
                    cet4: { color: '#F59E0B', light: '#FBBF24' },
                    cet6: { color: '#EF4444', light: '#F87171' },
                    ielts: { color: '#8B5CF6', light: '#A78BFA' },
                  };
                  const colors = cardColors[lib.level as keyof typeof cardColors] || cardColors.beginner;
                  return (
                    <div
                      key={lib.id}
                      className={`library-card ${selectedLibId === lib.id ? 'library-card--selected' : ''}`}
                      style={{ '--card-color': colors.color, '--card-color-light': colors.light } as React.CSSProperties}
                      onClick={() => !loading && setSelectedLibId(lib.id)}
                    >
                      <div className="library-card__badge" data-level={lib.level}>
                        {lib.level === 'beginner' ? '🌱' : lib.level === 'cet4' ? '📗' : lib.level === 'cet6' ? '📘' : '🎯'}
                      </div>
                      <div className="library-card__icon">
                        {lib.level === 'beginner' ? '📚' : lib.level === 'cet4' ? '📖' : lib.level === 'cet6' ? '🎓' : '✨'}
                      </div>
                      <div className="library-card__name">{lib.name}</div>
                      <div className="library-card__count">{lib.word_count > 0 ? `${lib.word_count.toLocaleString()} 词汇` : '即将上线'}</div>
                      <div className="library-card__level">
                        {lib.level === 'beginner' ? '初级' : lib.level === 'cet4' ? '中级' : lib.level === 'cet6' ? '高级' : '雅思'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Start Button */}
              <button
                className="start-button"
                onClick={handleStart}
                disabled={loading || !selectedLibId}
              >
                {loading ? (
                  <>
                    <span className="loading-spinner" />
                    生成中...
                  </>
                ) : (
                  <>开始练习 →</>
                )}
              </button>
            </>
          ) : (
            /* ========== Practice View ========== */
            <>
              {/* Back Button */}
              <button className="back-button" onClick={handleBackToLibrary}>
                ← 返回词库
              </button>

              {showNavigation && currentSentence && (
                <>
                  {/* Progress Header */}
                  <div className="progress-header">
                    <span className="progress-header__question">
                      题目 {currentIndex + 1} / {sentences.length}
                    </span>
                    <span className="progress-header__streak">
                      🔥 {stats.streak} 连击
                    </span>
                    <span className="progress-header__xp">
                      ⭐ +10 XP
                    </span>
                  </div>

                  {/* Chinese Hint */}
                  <div className="chinese-text-hint">
                    <p className="chinese-text">{currentSentence.chinese_text || '根据音频输入英文句子'}</p>
                  </div>

                  {/* Target Words Hint */}
                  {currentSentence.target_words && currentSentence.target_words.length > 0 && (
                    <div className="target-words-hint">
                      <span className="target-words-hint__label">重点词汇：</span>
                      {currentSentence.target_words.map((w, i) => (
                        <span key={i} className="target-word">{w}</span>
                      ))}
                    </div>
                  )}

                  {/* Audio Player */}
                  <div className="audio-player">
                    <button
                      className={`play-button ${isPlaying ? 'play-button--playing' : ''}`}
                      onClick={playAudio}
                      disabled={!currentSentence.audio_url || isPlaying || audioPlaysRemaining <= 0}
                    >
                      {isPlaying ? '🔊' : '▶️'}
                    </button>
                    <span className="replay-counter">
                      剩余 {audioPlaysRemaining} 次播放
                    </span>
                  </div>

                  {/* Inline Sentence Editor */}
                  <div className="sentence-display">
                    {currentSentence.text.split(/\s+/).map((word, index) => {
                      const isCorrectWord = wordResults[index];
                      const hasInput = !!userInputs[index];
                      const isActive = currentWordIndex === index && isCorrect === null;

                      return (
                        <div
                          key={index}
                          className={`word-slot ${isCorrectWord ? 'word-slot--correct' : ''} ${hasInput && !isCorrectWord ? 'word-slot--incorrect' : ''} ${isActive ? 'word-slot--active' : ''} ${hasInput || isActive ? 'word-slot--filled' : ''}`}
                          data-result={isCorrectWord ? '✓' : (!isCorrectWord && hasInput ? '✗' : '')}
                        >
                          {isActive ? (
                            <input
                              ref={el => inputRefs.current[index] = el}
                              type="text"
                              value={userInputs[index] || ''}
                              onChange={(e) => handleWordChange(index, e.target.value)}
                              onKeyDown={(e) => handleWordKeyDown(index, e)}
                              className="word-slot__input"
                              autoFocus
                              placeholder="..."
                            />
                          ) : (
                            <span className="word-slot__text">
                              {userInputs[index] || (isActive ? '' : '___')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress indicator */}
                  {isCorrect === null && (
                    <>
                      <div className="sentence-progress">
                        {sentences[currentIndex]?.text.split(/\s+/).map((_, index) => (
                          <div
                            key={index}
                            className={`sentence-progress__dot ${wordResults[index] ? 'sentence-progress__dot--filled' : ''} ${currentWordIndex === index ? 'sentence-progress__dot--current' : ''}`}
                          />
                        ))}
                      </div>
                      <div className="keyboard-hint">
                        输入完成后按 <kbd>Tab</kbd> 或 <kbd>Enter</kbd> 跳到下一个单词
                      </div>
                    </>
                  )}

                  {/* Submit Button (only show when all words entered) */}
                  {isCorrect === null && userInputs.every((inp, i) => {
                    const expected = currentSentence.text.split(/\s+/)[i]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
                    const actual = inp.toLowerCase().replace(/[.,!?;:'"]/g, '');
                    return actual === expected;
                  }) && (
                    <button className="submit-button" onClick={handleSubmit}>
                      提交答案
                    </button>
                  )}

                  {/* Action Buttons */}
                  {isCorrect !== null && (
                    <div className="action-buttons">
                      <button className="action-button action-button--hint" disabled>
                        💡 提示 (-2 XP)
                      </button>
                    </div>
                  )}

                  {/* Navigation */}
                  <div className="nav-buttons">
                    <button
                      className="nav-button nav-button--prev"
                      onClick={handlePrev}
                      disabled={currentIndex === 0}
                    >
                      ← 上一题
                    </button>
                    <button
                      className="nav-button nav-button--next"
                      onClick={handleNext}
                      disabled={currentIndex === sentences.length - 1}
                    >
                      下一题 →
                    </button>
                  </div>
                </>
              )}

              {loading && (
                <div className="loading">
                  <div className="loading__spinner" />
                  <div className="loading__text">正在生成练习...</div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-progress">
          <span className="footer-progress__label">今日进度</span>
          <div className="footer-progress__bar">
            <div
              className="footer-progress__fill"
              style={{ width: `${Math.min((todayProgress / 10) * 100, 100)}%` }}
            />
          </div>
          <span className="footer-progress__text">{todayProgress} / 10</span>
        </div>
      </footer>
    </div>
  );
}