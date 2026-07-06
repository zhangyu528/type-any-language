'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  getLib,
  loadTranslationProgress,
  saveTranslationProgress,
  TranslationProgress,
  TranslationSentenceProgress,
  LessonSentence,
  WordInLesson,
  LessonDetail,
} from './api';
import TranslationStage from './TranslationStage';

interface TranslationSessionProps {
  libId: string;
  onBack: () => void;
}

type SessionState = 'loading' | 'running' | 'empty-lib' | 'error';

interface PickedStep {
  word: WordInLesson;
  sentence: LessonSentence;
}

/**
 * TranslationSession — random-step ZH→EN drill for one lib.
 *
 * The "lesson" concept is gone. The whole lib is one giant pool of
 * (word, sentence) pairs, and the parent picks the next one via a
 * weighted random draw (see `pickNextStep`):
 *   - 4× weight for never-attempted steps
 *   - 3× weight for previously-wrong steps
 *   - 1× weight for previously-right steps
 *
 * The drill is unbounded — there is no "lesson complete" state. Users
 * keep drawing from the pool forever, with the wrong bucket gradually
 * depleting as they retry.
 */

const WEIGHT_UNANSWERED = 4;
const WEIGHT_WRONG = 3;
const WEIGHT_RIGHT = 1;

function bucketFor(
  progress: TranslationProgress,
  libId: string,
  sentenceId: string
): 'unanswered' | 'right' | 'wrong' {
  const p = progress[libId]?.sentences?.[sentenceId];
  if (!p) return 'unanswered';
  return p.correct ? 'right' : 'wrong';
}

function pickNextStep(
  lesson: LessonDetail,
  progress: TranslationProgress,
  libId: string
): PickedStep | null {
  // Expand the whole lesson into (word, sentence) pairs. Words with
  // zero baked sentences are skipped — they have nothing to drill on.
  const allSteps: PickedStep[] = [];
  for (const w of lesson.words) {
    const sentences = lesson.sentences_by_word[w.word.toLowerCase()] ?? [];
    for (const s of sentences) {
      allSteps.push({ word: w, sentence: s });
    }
  }
  if (allSteps.length === 0) return null;

  // Build weighted pool.
  const pool: PickedStep[] = [];
  for (const step of allSteps) {
    const bucket = bucketFor(progress, libId, step.sentence.id);
    const weight =
      bucket === 'unanswered'
        ? WEIGHT_UNANSWERED
        : bucket === 'wrong'
          ? WEIGHT_WRONG
          : WEIGHT_RIGHT;
    for (let i = 0; i < weight; i++) pool.push(step);
  }
  // Defensive: pool should never be empty if allSteps is non-empty.
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function TranslationSession({
  libId,
  onBack,
}: TranslationSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [error, setError] = useState('');
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [currentStep, setCurrentStep] = useState<PickedStep | null>(null);

  // Initial load: lesson + progress + first pick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [l, p] = await Promise.all([
          getLib(libId),
          Promise.resolve(loadTranslationProgress()),
        ]);
        if (cancelled) return;
        setLesson(l);
        setProgress(p);
        const first = pickNextStep(l, p, libId);
        if (!first) {
          setSessionState('empty-lib');
        } else {
          setCurrentStep(first);
          setSessionState('running');
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载课程失败');
          setSessionState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // libId is the only meaningful dependency; pickNextStep is stable
    // and reads from the latest lesson/progress via closure on `l`/`p`.
  }, [libId]);

  /**
   * Record the answer for the current step's sentence and draw the
   * next one. The new step is staged in `pendingStep` so React batches
   * the progress update + new render in a single commit — avoids
   * flashing the previous step's success state for one frame.
   */
  const handleStepComplete = useCallback(
    (correct: boolean) => {
      if (!lesson || !currentStep) return;
      const sentenceId = currentStep.sentence.id;

      // Write progress atomically. The blob is per-LIB now (no
      // lessonIndex grouping), so we just merge the new entry into
      // the lib's sentences map.
      const libBucket = progress[libId] ?? { sentences: {} };
      const sentencesBucket = libBucket.sentences ?? {};
      const updatedSentence: TranslationSentenceProgress = { correct };
      const nextProgress: TranslationProgress = {
        ...progress,
        [libId]: {
          ...libBucket,
          sentences: { ...sentencesBucket, [sentenceId]: updatedSentence },
        },
      };
      setProgress(nextProgress);
      saveTranslationProgress(nextProgress);

      // Draw the next step using the freshly-written progress so a
      // self-corrected step doesn't immediately re-surface.
      const next = pickNextStep(lesson, nextProgress, libId);
      setCurrentStep(next);
      if (!next) setSessionState('empty-lib');
    },
    [progress, libId, lesson, currentStep]
  );

  // Aggregate stats for the meta line.
  const stats = useMemo(() => {
    if (!lesson) return null;
    let total = 0;
    let answered = 0;
    let correct = 0;
    for (const w of lesson.words) {
      const sentences = lesson.sentences_by_word[w.word.toLowerCase()] ?? [];
      total += sentences.length;
      for (const s of sentences) {
        const p = progress[libId]?.sentences?.[s.id];
        if (p) {
          answered += 1;
          if (p.correct) correct += 1;
        }
      }
    }
    return { total, answered, correct, percent: total > 0 ? Math.round((correct / total) * 100) : 0 };
  }, [lesson, progress, libId]);

  // Per-word count for the active step (small "本词已答 N 句").
  const currentWordAnswered = useMemo(() => {
    if (!lesson || !currentStep) return 0;
    const wordKey = currentStep.word.word.toLowerCase();
    const sentences = lesson.sentences_by_word[wordKey] ?? [];
    let n = 0;
    for (const s of sentences) {
      if (progress[libId]?.sentences?.[s.id]) n += 1;
    }
    return n;
  }, [lesson, currentStep, progress, libId]);

  // ---- Render ----

  if (sessionState === 'loading' || !lesson) {
    return (
      <div className="translation translation--loading">
        <div className="translation__loader" aria-hidden>
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <p className="translation__loader-text">Loading…</p>
      </div>
    );
  }

  if (sessionState === 'error') {
    return (
      <div className="translation translation--error">
        <p className="translation__error-text">{error}</p>
        <button type="button" className="translation__btn translation__btn--ghost" onClick={onBack}>
          返回
        </button>
      </div>
    );
  }

  if (sessionState === 'empty-lib' || !currentStep) {
    return (
      <div className="translation translation--empty-step">
        <p className="translation__caption">本词库</p>
        <p className="translation__empty-text">
          该词库暂无可练习的句子
        </p>
        <div className="translation__actions">
          <button type="button" className="translation__btn translation__btn--primary" onClick={onBack}>
            返回词库列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <TranslationStage
        sentence={currentStep.sentence}
        targetWord={currentStep.word}
        onComplete={handleStepComplete}
      />
      {stats && (
        <p className="translation__meta" aria-label="练习进度">
          已答 {stats.correct} / {stats.total} 句 ({stats.percent}%)
          {' · '}
          本词 {currentWordAnswered} 句
        </p>
      )}
    </>
  );
}