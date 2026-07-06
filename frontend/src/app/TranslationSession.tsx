'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  getLesson,
  loadTranslationProgress,
  saveTranslationProgress,
  TranslationProgress,
  LessonSentence,
} from './api';
import TranslationStage from './TranslationStage';

interface TranslationSessionProps {
  libId: string;
  lessonIndex: number;
  onBack: () => void;
  onNextLesson?: () => void;
}

type StepState = 'loading' | 'running' | 'finished' | 'error';

interface FlatStep {
  /** The target word this step is exercising (already-lowercased key
   *  matches the progress blob). */
  wordKey: string;
  /** The sentence to render. `undefined` when the word has no baked
   *  sentences — `handleStepComplete` will auto-pass these. */
  sentence: LessonSentence | undefined;
}

/**
 * TranslationSession — multi-step ZH→EN drill orchestrator.
 *
 * Each lesson is a flat sequence of (word, sentence) pairs:
 *   word_1 sentence_1, word_1 sentence_2, ..., word_1 sentence_N,
 *   word_2 sentence_1, ...,
 *   ... word_M sentence_N.
 *
 * M = `lesson.words.length` (typically 5), N varies per word — every
 * baked sentence for the word gets used in order. A word with no
 * sentences is treated as auto-passed so the lesson can complete.
 *
 * Progress writes only the `zh2enCorrect` flag (single-direction).
 * A lesson is complete when every word's `zh2enCorrect` is true.
 */
export default function TranslationSession({
  libId,
  lessonIndex,
  onBack,
  onNextLesson,
}: TranslationSessionProps) {
  const [stepState, setStepState] = useState<StepState>('loading');
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [lesson, setLesson] = useState<Awaited<ReturnType<typeof getLesson>> | null>(null);
  const [progress, setProgress] = useState<TranslationProgress>({});

  // Load lesson + progress on mount or when params change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [l, p] = await Promise.all([
          getLesson(libId, lessonIndex),
          Promise.resolve(loadTranslationProgress()),
        ]);
        if (cancelled) return;
        setLesson(l);
        setProgress(p);
        setStepState('running');
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载课程失败');
          setStepState('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [libId, lessonIndex]);

  /** Flatten (word × sentence) into a single step array. Words with
   *  zero baked sentences are recorded as `sentence: undefined` so the
   *  handler can auto-pass them — without this, the lesson would
   *  never finish when the CMS hasn't filled a particular bucket yet. */
  const flatSteps = useMemo<FlatStep[]>(() => {
    if (!lesson) return [];
    const out: FlatStep[] = [];
    for (const w of lesson.words) {
      const wordKey = w.word.toLowerCase();
      const sentences = lesson.sentences_by_word[wordKey] ?? [];
      if (sentences.length === 0) {
        out.push({ wordKey, sentence: undefined });
      } else {
        for (const s of sentences) {
          out.push({ wordKey, sentence: s });
        }
      }
    }
    return out;
  }, [lesson]);

  const totalSteps = flatSteps.length;
  const activeStep = stepState === 'running' ? flatSteps[currentStep] ?? null : null;

  /**
   * Update one word's `zh2enCorrect` flag. Returns the updated blob so
   * we can decide completion in one place.
   */
  const recordStep = useCallback(
    (
      next: TranslationProgress,
      wordKey: string,
      correct: boolean
    ): TranslationProgress => {
      const libBucket = next[libId] ?? {};
      const lessonBucket = libBucket[lessonIndex] ?? {
        words: {},
      };
      const wordBucket = lessonBucket.words[wordKey] ?? {
        zh2enCorrect: false,
      };
      wordBucket.zh2enCorrect = correct;

      const updatedLesson = {
        ...lessonBucket,
        words: { ...lessonBucket.words, [wordKey]: wordBucket },
      };

      return {
        ...next,
        [libId]: {
          ...libBucket,
          [lessonIndex]: updatedLesson,
        },
      };
    },
    [libId, lessonIndex]
  );

  /**
   * Decide whether the lesson is fully translated and stamp `completedAt`.
   * A lesson is complete when EVERY word has `zh2enCorrect` true. Words
   * with no baked sentences are auto-passed here (they show up in the
   * flat steps as `sentence: undefined` and trigger auto-pass on advance).
   */
  const maybeStampCompletion = useCallback(
    (candidates: TranslationProgress): TranslationProgress => {
      if (!lesson) return candidates;
      const lessonBucket = candidates[libId]?.[lessonIndex];
      if (!lessonBucket) return candidates;
      const wordKeys = lesson.words.map((w) => w.word.toLowerCase());
      const allDone = wordKeys.every((k) => {
        const w = lessonBucket.words[k];
        return Boolean(w?.zh2enCorrect);
      });
      if (allDone && !lessonBucket.completedAt) {
        return {
          ...candidates,
          [libId]: {
            ...candidates[libId],
            [lessonIndex]: {
              ...lessonBucket,
              completedAt: Date.now(),
            },
          },
        };
      }
      return candidates;
    },
    [lesson, libId, lessonIndex]
  );

  const handleStepComplete = useCallback(
    (correct: boolean) => {
      if (!activeStep) return;
      const { wordKey, sentence } = activeStep;

      // No sentence baked for this word → auto-pass (mark zh2enCorrect true)
      // so the lesson can complete. We don't care if the user got it "right"
      // because there's nothing to translate.
      if (!sentence) {
        let next: TranslationProgress = progress;
        next = recordStep(next, wordKey, true);
        next = maybeStampCompletion(next);
        setProgress(next);
        saveTranslationProgress(next);
        advanceOrFinish();
        return;
      }

      let next: TranslationProgress = progress;
      next = recordStep(next, wordKey, correct);
      next = maybeStampCompletion(next);
      setProgress(next);
      saveTranslationProgress(next);
      advanceOrFinish();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeStep, currentStep, progress, recordStep, maybeStampCompletion]
  );

  const advanceOrFinish = useCallback(() => {
    setCurrentStep((s) => {
      const next = s + 1;
      if (next >= totalSteps) {
        setStepState('finished');
        return s;
      }
      return next;
    });
  }, [totalSteps]);

  // ---- Render ----

  if (stepState === 'loading' || !lesson) {
    return (
      <div className="translation translation--loading">
        <div className="translation__loader" aria-hidden>
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <p className="translation__loader-text">Loading…</p>
      </div>
    );
  }

  if (stepState === 'error') {
    return (
      <div className="translation translation--error">
        <p className="translation__error-text">{error}</p>
        <button type="button" className="translation__btn translation__btn--ghost" onClick={onBack}>
          返回
        </button>
      </div>
    );
  }

  if (stepState === 'finished') {
    const lessonProgress = progress[libId]?.[lessonIndex];
    return (
      <div className="translation translation--finished">
        <p className="translation__caption">本课翻译</p>
        <h2 className="translation__end-title">已完成</h2>
        <p className="translation__end-meta">
          {lesson.words.length} 个单词 · 翻译练习完成
        </p>
        <div className="translation__actions">
          <button type="button" className="translation__btn translation__btn--ghost" onClick={onBack}>
            返回课程列表
          </button>
          {onNextLesson && lessonProgress?.completedAt && (
            <button
              type="button"
              className="translation__btn translation__btn--primary"
              onClick={onNextLesson}
            >
              下一课 →
            </button>
          )}
        </div>
      </div>
    );
  }

  // stepState === 'running'
  if (!activeStep) {
    return (
      <div className="translation translation--error">
        <p className="translation__error-text">课程数据缺失</p>
      </div>
    );
  }

  const { wordKey, sentence } = activeStep;
  const word = lesson.words.find((w) => w.word.toLowerCase() === wordKey);
  if (!word) {
    return (
      <div className="translation translation--error">
        <p className="translation__error-text">课程数据缺失</p>
      </div>
    );
  }

  // Edge: word has no sentences baked → auto-pass with a friendly explainer.
  if (!sentence) {
    return (
      <div className="translation translation--empty-step">
        <p className="translation__caption">看中文写英文 · {word.word}</p>
        <p className="translation__empty-text">
          该词暂无翻译句子，已自动跳过
        </p>
        <div className="translation__actions">
          <button
            type="button"
            className="translation__btn translation__btn--primary"
            onClick={() => handleStepComplete(true)}
          >
            继续 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <TranslationStage
      sentence={sentence}
      stepIndex={currentStep}
      totalSteps={totalSteps}
      targetWord={word}
      onComplete={handleStepComplete}
    />
  );
}