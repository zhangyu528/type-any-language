'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getLesson,
  loadLessonProgress,
  saveLessonProgress,
  LessonDetail,
  LessonProgress,
  LessonSentence,
  Sentence,
  WordInLesson,
} from './api';
import RecognitionStage from './RecognitionStage';
import DictationStage from './DictationStage';

interface LessonSessionProps {
  libId: string;
  lessonIndex: number;
  onBack: () => void;
  /** Called when the user clicks "继续下一课" at the end-of-lesson screen. */
  onNextLesson?: () => void;
}

type Step = 'loading' | 'running' | 'finished' | 'error';

/**
 * Pick the best sentence for a given stage of a target word.
 *
 * Stage 1 (识词) prefers a beginner sentence — short, simple, the user
 * hears the target word in its easiest context. Stage 2 (听写) prefers
 * intermediate (the current dictation default). If the requested
 * difficulty has no sentence for this word, fall back gracefully:
 * Stage 1 → any available; Stage 2 → any non-beginner (variety).
 */
function pickSentence(
  sentences: LessonSentence[] | undefined,
  difficulty: 'beginner' | 'intermediate'
): LessonSentence | undefined {
  if (!sentences || sentences.length === 0) return undefined;
  const exact = sentences.find((s) => s.difficulty === difficulty);
  if (exact) return exact;
  if (difficulty === 'beginner') {
    // No beginner sentence: take any.
    return sentences[0];
  }
  // Stage 2 fallback: skip beginner if possible (more substance for
  // a dictation cell), otherwise take whatever's there.
  return (
    sentences.find((s) => s.difficulty !== 'beginner') ?? sentences[0]
  );
}

/** Convert a LessonSentence to the Sentence shape DictationStage expects. */
function toSentence(s: LessonSentence): Sentence {
  return {
    id: s.id,
    text: s.text,
    chinese_text: s.chinese_text,
    target_words: [],
    difficulty: s.difficulty,
    audio_url: s.audio_url || null,
    is_cached: true,
  };
}

/**
 * LessonSession — runs one lesson: 5 target words × 2 stages.
 *
 * Stage ladder per word (10 total steps):
 *   step 0, 2, 4, 6, 8  → word N · Stage 1 (识词)
 *   step 1, 3, 5, 7, 9  → word N · Stage 2 (听写)
 *
 * Stage 1 always advances (no pass/fail — it's a "see the word"
 * step). Stage 2 emits `correct` (typed all cells) or `skipped`
 * (user clicked 跳过本词). On every transition we write to
 * localStorage so a reload picks up where the user left off.
 *
 * End-of-lesson:
 *   - The lesson is "completed" only if all 5 words reached stage 2
 *     (whether by typing or by completing the dictation). Skipped
 *     words stay at stage 1 and the lesson is NOT marked complete
 *     (the unlock rule requires all 5 words at stage 2).
 *   - The end card shows 2 actions: 返回课程列表 and (if applicable)
 *     继续 Lesson N+1.
 */
export default function LessonSession({
  libId,
  lessonIndex,
  onBack,
  onNextLesson,
}: LessonSessionProps) {
  const [step, setStep] = useState<Step>('loading');
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState<LessonProgress>({});

  // Initial load: fetch the lesson + read progress snapshot.
  useEffect(() => {
    let cancelled = false;
    setStep('loading');
    setCurrentStep(0);
    (async () => {
      try {
        const [detail, prog] = await Promise.all([
          getLesson(libId, lessonIndex),
          Promise.resolve(loadLessonProgress()),
        ]);
        if (cancelled) return;
        setLesson(detail);
        setProgress(prog);
        setStep('running');
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载课程失败');
          setStep('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [libId, lessonIndex]);

  const totalSteps = useMemo(() => {
    if (!lesson) return 0;
    return lesson.words.length * 2;  // 2 stages per word
  }, [lesson]);

  // Helper: derive the (word, stage) for a given step index.
  const activeStep = useMemo(() => {
    if (!lesson) return null;
    const wordIdx = Math.floor(currentStep / 2);
    const stage: 1 | 2 = currentStep % 2 === 0 ? 1 : 2;
    return {
      wordIdx,
      stage,
      word: lesson.words[wordIdx],
      sentences: lesson.sentences_by_word[lesson.words[wordIdx].word] ?? [],
    };
  }, [currentStep, lesson]);

  /** Persist a per-word stage advancement into localStorage. */
  const recordStage = (word: WordInLesson, stage: 1 | 2) => {
    setProgress((prev) => {
      const libProg = prev[libId] ?? {};
      const lessonProg = libProg[lessonIndex] ?? { words: {} };
      const existing = lessonProg.words[word.word];
      const newMax = Math.max(existing?.maxStage ?? 0, stage) as 1 | 2;
      const next: LessonProgress = {
        ...prev,
        [libId]: {
          ...libProg,
          [lessonIndex]: {
            words: {
              ...lessonProg.words,
              [word.word]: {
                maxStage: newMax,
                completedAt: existing?.completedAt ?? Date.now(),
              },
            },
            completedAt: lessonProg.completedAt,
          },
        },
      };
      saveLessonProgress(next);
      return next;
    });
  };

  /** Mark the lesson complete (all words reached stage 2). */
  const markLessonComplete = () => {
    setProgress((prev) => {
      const libProg = prev[libId] ?? {};
      const lessonProg = libProg[lessonIndex] ?? { words: {} };
      const next: LessonProgress = {
        ...prev,
        [libId]: {
          ...libProg,
          [lessonIndex]: {
            words: lessonProg.words,
            completedAt: Date.now(),
          },
        },
      };
      saveLessonProgress(next);
      return next;
    });
  };

  const handleAdvanceFromRecognition = () => {
    // Stage 1 always passes — record and move to stage 2 of the same word.
    if (!activeStep) return;
    recordStage(activeStep.word, 1);
    setCurrentStep((s) => s + 1);
  };

  const handleCompleteFromDictation = (correct: boolean) => {
    if (!activeStep) return;
    if (correct) {
      recordStage(activeStep.word, 2);
    }
    // Skipped: do not mark stage 2 — user can re-attempt on next visit.
    if (currentStep + 1 >= totalSteps) {
      // End of lesson.
      const allStage2 =
        lesson?.words.every((w) => {
          const mp = progress[libId]?.[lessonIndex]?.words?.[w.word];
          if (correct && w.word === activeStep.word.word) {
            return true;  // we just marked this one
          }
          return (mp?.maxStage ?? 0) >= 2;
        }) ?? false;
      if (allStage2) {
        markLessonComplete();
      }
      setStep('finished');
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  if (step === 'loading' || !lesson || !activeStep) {
    return (
      <div className="lesson-session lesson-session--loading">
        <div className="practice__loader" aria-hidden>
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="lesson-session lesson-session--error">
        <p className="lesson-session__error-text">{error}</p>
        <button type="button" className="lesson-session__back" onClick={onBack}>
          返回课程列表
        </button>
      </div>
    );
  }

  if (step === 'finished') {
    const masteredCount = lesson.words.filter((w) => {
      const mp = progress[libId]?.[lessonIndex]?.words?.[w.word];
      return (mp?.maxStage ?? 0) >= 2;
    }).length;
    const isComplete = masteredCount === lesson.words.length;

    return (
      <div className="lesson-session">
        <div className="score">
          <svg className="score__enso" viewBox="0 0 100 100" aria-hidden>
            <circle
              cx="50" cy="50" r="42"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray="240 28"
              transform="rotate(-30 50 50)"
            />
          </svg>
          <h2 className="score__title">
            {masteredCount} / {lesson.words.length}
          </h2>
          <p className="score__text">
            {isComplete
              ? `Lesson ${lessonIndex} 完成 — 全部 ${lesson.words.length} 个单词进入听写阶段。`
              : `${masteredCount} / ${lesson.words.length} 词已听写。完成所有单词以解锁下一课。`}
          </p>
          <div className="lesson-session__finished-actions">
            <button
              type="button"
              className="score__again"
              onClick={onBack}
            >
              返回课程列表
            </button>
            {isComplete && onNextLesson && (
              <button
                type="button"
                className="score__again"
                onClick={onNextLesson}
              >
                继续 Lesson {lessonIndex + 1} →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Running: render the current stage.
  return (
    <div className="lesson-session">
      <header className="lesson-session__header">
        <button
          type="button"
          className="lesson-session__back-button"
          onClick={onBack}
          aria-label="返回课程列表"
        >
          ←
        </button>
        <p className="lesson-session__caption">
          Lesson {lessonIndex} · 单词 {activeStep.wordIdx + 1} / {lesson.words.length} · 阶段 {activeStep.stage} / 2
        </p>
      </header>

      {/* 10-step progress — small dots matching the existing .progress style. */}
      <div className="progress" role="list" aria-label="课程进度">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const status =
            i < currentStep
              ? 'progress__dot--correct'
              : i === currentStep
                ? 'progress__dot--current'
                : '';
          return (
            <span
              key={i}
              className={'progress__dot ' + status}
              role="listitem"
              aria-label={
                i === currentStep
                  ? `第 ${i + 1} 步（当前）`
                  : i < currentStep
                    ? `第 ${i + 1} 步（完成）`
                    : `第 ${i + 1} 步`
              }
            />
          );
        })}
      </div>

      {activeStep.stage === 1 ? (
        <RecognitionStage
          key={`r-${currentStep}`}
          word={activeStep.word}
          sentences={activeStep.sentences}
          onAdvance={handleAdvanceFromRecognition}
        />
      ) : (
        (() => {
          const sentence = pickSentence(
            activeStep.sentences,
            'intermediate'
          );
          if (!sentence) {
            return (
              <div className="dictation">
                <p className="dictation__no-sentence">
                  （该单词暂无听写句子，已跳过）
                </p>
                <button
                  type="button"
                  className="dictation__skip"
                  onClick={() => handleCompleteFromDictation(false)}
                >
                  继续 →
                </button>
              </div>
            );
          }
          return (
            <DictationStage
              key={`d-${currentStep}`}
              sentence={toSentence(sentence)}
              targetWord={activeStep.word}
              onComplete={handleCompleteFromDictation}
            />
          );
        })()
      )}
    </div>
  );
}
