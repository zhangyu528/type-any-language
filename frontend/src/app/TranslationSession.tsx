'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  getLesson,
  loadTranslationProgress,
  saveTranslationProgress,
  TranslationProgress,
} from './api';
import { pickSentence } from './pickSentence';
import TranslationStage, { TranslationDirection } from './TranslationStage';

interface TranslationSessionProps {
  libId: string;
  lessonIndex: number;
  onBack: () => void;
  onNextLesson?: () => void;
}

type StepState = 'loading' | 'running' | 'finished' | 'error';

/**
 * TranslationSession — 5-step orchestrator for the standalone translation
 * drill. Lighter than LessonSession: no RecognitionStage, no per-cell
 * typewriter, just one sentence per word × two directions (alternating).
 *
 * Direction alternation per step (5 steps total):
 *   step 0 → EN→ZH   (read English, type Chinese)
 *   step 1 → ZH→EN   (read Chinese, type English)
 *   step 2 → EN→ZH
 *   step 3 → ZH→EN
 *   step 4 → EN→ZH
 *
 * Progress is written to `translationProgress` (the only progress blob
 * the app writes). No lock cascade — lessons are independent.
 *
 * Missing-data edge cases (handled gracefully):
 *   - Word has no baked sentences → step shows "暂无句子，自动跳过", mark
 *     both flags true and advance.
 *   - Sentence missing chinese_text → EN→ZH step shows "暂无中文翻译，自动
 *     跳过", mark en2zhCorrect true and advance.
 *   - Sentence missing audio_url → EN→ZH step still works (no autoplay),
 *     🔊 button hidden.
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

  /** Direction for a given step index — alternates EN→ZH / ZH→EN. */
  const directionFor = useCallback((stepIdx: number): TranslationDirection => {
    return stepIdx % 2 === 0 ? 'en2zh' : 'zh2en';
  }, []);

  /** Look up the active word + sentence for the current step. */
  const activeStep = useMemo(() => {
    if (!lesson || stepState !== 'running') return null;
    const wordIdx = currentStep; // 1:1 mapping — 5 steps, 5 words.
    const word = lesson.words[wordIdx];
    if (!word) return null;
    const sentences = lesson.sentences_by_word[word.word.toLowerCase()] ?? [];
    const sentence = pickSentence(sentences, 'beginner');
    return { word, sentence };
  }, [lesson, stepState, currentStep]);

  /**
   * Persist per-word progress flags into the blob.
   * Returns the updated blob so we can decide completion in one place.
   */
  const recordStep = useCallback(
    (
      next: TranslationProgress,
      wordKey: string,
      dir: TranslationDirection,
      correct: boolean
    ): TranslationProgress => {
      const libBucket = next[libId] ?? {};
      const lessonBucket = libBucket[lessonIndex] ?? {
        words: {},
      };
      const wordBucket = lessonBucket.words[wordKey] ?? {
        en2zhCorrect: false,
        zh2enCorrect: false,
      };
      wordBucket[dir === 'en2zh' ? 'en2zhCorrect' : 'zh2enCorrect'] = correct;

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
   * A lesson is complete when EVERY word has both en2zhCorrect and
   * zh2enCorrect true. The active step's update is already merged into
   * `candidates`; we re-check after each step.
   */
  const maybeStampCompletion = useCallback(
    (candidates: TranslationProgress): TranslationProgress => {
      if (!lesson) return candidates;
      const lessonBucket = candidates[libId]?.[lessonIndex];
      if (!lessonBucket) return candidates;
      const wordKeys = lesson.words.map((w) => w.word.toLowerCase());
      const allDone = wordKeys.every((k) => {
        const w = lessonBucket.words[k];
        return w && w.en2zhCorrect && w.zh2enCorrect;
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
      const { word, sentence } = activeStep;
      const dir = directionFor(currentStep);
      const wordKey = word.word.toLowerCase();

      // Edge case: no sentence baked for this word — auto-pass both
      // directions so the lesson can complete.
      if (!sentence) {
        let next: TranslationProgress = progress;
        next = recordStep(next, wordKey, 'en2zh', true);
        next = recordStep(next, wordKey, 'zh2en', true);
        next = maybeStampCompletion(next);
        setProgress(next);
        saveTranslationProgress(next);
        advanceOrFinish();
        return;
      }

      // Edge case: EN→ZH direction with missing chinese_text — auto-pass
      // that direction.
      if (correct && dir === 'en2zh' && !sentence.chinese_text) {
        let next: TranslationProgress = progress;
        next = recordStep(next, wordKey, dir, true);
        next = maybeStampCompletion(next);
        setProgress(next);
        saveTranslationProgress(next);
        advanceOrFinish();
        return;
      }

      // Edge case: ZH→EN direction with missing english text — auto-pass.
      if (correct && dir === 'zh2en' && !sentence.text) {
        let next: TranslationProgress = progress;
        next = recordStep(next, wordKey, dir, true);
        next = maybeStampCompletion(next);
        setProgress(next);
        saveTranslationProgress(next);
        advanceOrFinish();
        return;
      }

      let next: TranslationProgress = progress;
      next = recordStep(next, wordKey, dir, correct);
      next = maybeStampCompletion(next);
      setProgress(next);
      saveTranslationProgress(next);
      advanceOrFinish();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeStep, currentStep, progress, directionFor, recordStep, maybeStampCompletion]
  );

  const advanceOrFinish = useCallback(() => {
    setCurrentStep((s) => {
      const next = s + 1;
      if (!lesson) return s;
      if (next >= lesson.words.length) {
        setStepState('finished');
        return s;
      }
      return next;
    });
  }, [lesson]);

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

  const { word, sentence } = activeStep;
  const totalSteps = lesson.words.length;
  const dir = directionFor(currentStep);

  // Edge: word has no sentences baked.
  if (!sentence) {
    return (
      <div className="translation translation--empty-step">
        <p className="translation__caption">翻译 · {word.word}</p>
        <p className="translation__empty-text">
          该词暂无听写句子，已自动跳过
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
      direction={dir}
      stepIndex={currentStep}
      totalSteps={totalSteps}
      targetWord={word}
      onComplete={handleStepComplete}
    />
  );
}