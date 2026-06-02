'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getVocabularyLibs, generateSentences, checkAnswer, getAudioUrl, Sentence } from './api';

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    }
  }, [sentences, currentIndex]);

  useEffect(() => {
    setIsPlaying(false);
  }, [currentIndex]);

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCorrect]);

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
      audioRef.current.play().catch(() => {});
    }
  }, [sentences, currentIndex]);

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

  const currentSentence = sentences[currentIndex];
  const allWordsFilled = userInputs.every((inp, i) => {
    const expected = currentSentence?.text.split(/\s+/)[i]?.toLowerCase().replace(/[.,!?;:'"]/g, '');
    const actual = inp.toLowerCase().replace(/[.,!?;:'"]/g, '');
    return actual === expected;
  });

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
        onPlay={() => setIsPlaying(true)}
        onEnded={() => setIsPlaying(false)}
      />
      <div className="immersive-content">
        {currentSentence && (
          <>
            <div className="waveform-container" title="Click or hover to play audio">
              <button
                type="button"
                className="waveform-button"
                title="Click or hover to play audio"
                onClick={(e) => {
                e.stopPropagation();
                playAudio();
                setTimeout(() => {
                  inputRefs.current[currentWordIndex]?.focus();
                }, 50);
              }} onMouseEnter={() => playAudio()}>
                <div className={`waveform ${isPlaying ? 'playing' : ''}`}>
                  <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                </div>
              </button>
              <span className="progress-text">{currentIndex + 1} / {sentences.length}</span>
            </div>

            <div className="sentence-area" onClick={() => inputRefs.current[0]?.focus()}>
              <p className="sentence-hint">{currentSentence.chinese_text || 'Listen and type the sentence'}</p>

              <div className="sentence-display typewriter-mode" onClick={(e) => {
                e.stopPropagation();
                inputRefs.current[0]?.focus();
              }}>
                {/* Single continuous line for all words */}
              <div className="sentence-line">
                {currentSentence.text.split(/\s+/).map((word, index) => {
                  const isCorrectWord = wordResults[index];
                  const isActive = currentWordIndex === index && isCorrect === null;
                  const input = userInputs[index] || '';

                  return (
                    <span key={index} className={`line-word ${isCorrectWord ? 'line-word--correct' : ''} ${isActive ? 'line-word--active' : ''}`}>
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
                        <span className="line-word-empty" style={{ width: (word.length + 2) * 0.65 + 'em' }}></span>
                      )}
                      {index < currentSentence.text.split(/\s+/).length - 1 && <span className="line-space"></span>}
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

              <div className="tips-area">
                <span className="tip-text">Space: Play audio • Tab: Show/Hide answer</span>
              </div>

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