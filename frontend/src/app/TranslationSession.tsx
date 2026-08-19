'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  getLib,
  loadTranslationProgress,
  saveTranslationProgress,
  startPracticeSession,
  endPracticeSession,
  recordPracticeStep,
  TranslationProgress,
  TranslationSentenceProgress,
  LessonSentence,
  WordInLesson,
  LessonDetail,
} from './api';
import { useAuth } from './lib/auth';
import { useAuthModal } from './lib/authModal';
import TranslationStage from './TranslationStage';
import PracticeHintCard, {
  type PracticeHintCardKind,
} from './practice/PracticeHintCard';
import LoadingMark from './components/LoadingMark';
import Stat from './ds/components/Stat';
import Button from './ds/components/Button';
import SpecularButton from '@/components/SpecularButton';
import styles from './practice/TranslationStage.module.css';

interface TranslationSessionProps {
  libId: string;
  onBack: () => void;
}

type SessionState = 'loading' | 'running' | 'empty-lib' | 'error' | 'finished';

interface PickedStep {
  word: WordInLesson;
  sentence: LessonSentence;
}

interface HintCardState {
  improvedCardShown: boolean;
  rateCardShown: boolean;
  dismissedThisSession: boolean;
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

/**
 * Look up a specific (word, sentence) pair by sentence id. Used by
 * Phase 3.1: when /?lib=X&sentence=Y arrives, the session skips
 * pickNextStep and renders this exact step. Returns null if the id
 * is not in the loaded lib — caller should fall back to pickNextStep
 * so a hand-typed bad URL doesn't render an empty screen.
 */
function pickStepBySentenceId(
  lesson: LessonDetail,
  sentenceId: string,
): PickedStep | null {
  for (const w of lesson.words) {
    const sentences = lesson.sentences_by_word[w.word.toLowerCase()] ?? [];
    for (const s of sentences) {
      if (s.id === sentenceId) {
        return { word: w, sentence: s };
      }
    }
  }
  return null;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export default function TranslationSession({
  libId,
  onBack,
}: TranslationSessionProps) {
  const { user } = useAuth();
  const { open: openAuthModal } = useAuthModal();
  // Anonymous users share one bucket (ANONYMOUS_USER_ID); signed-in
  // users get a per-userId bucket. The localStorage key prefix is
  // derived from this in api.ts helpers.
  const userId = user?.id ?? 'anonymous';
  const isGuest = !user;
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [error, setError] = useState('');
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [currentStep, setCurrentStep] = useState<PickedStep | null>(null);

  // Guest-only trigger state. Reset on libId change (new session).
  const [sessionStats, setSessionStats] = useState({
    total: 0,
    correct: 0,
    streak: 0,
    maxStreak: 0,
    startTime: Date.now(),
  });
  const [lastResult, setLastResult] = useState<
    'correct' | 'wrong' | 'skipped' | null
  >(null);
  const [cardState, setCardState] = useState<HintCardState>({
    improvedCardShown: false,
    rateCardShown: false,
    dismissedThisSession: false,
  });
  const [activeHint, setActiveHint] = useState<PracticeHintCardKind | null>(
    null
  );

  // Live study-timer — ticks every second while the drill is running.
  // sessionStats.startTime is the single source of truth (reset on mount
  // + restart), so the effect re-syncs whenever it changes.
  const [elapsedSecs, setElapsedSecs] = useState(0);
  useEffect(() => {
    if (sessionState !== 'running') return;
    const start = sessionStats.startTime;
    const tick = () =>
      setElapsedSecs(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sessionState, sessionStats.startTime]);

  // Streak milestone celebration — fires a transient "连击 N！" badge
  // whenever the streak lands on a multiple of 5 (5/10/15…). A ref
  // tracks the last celebrated value so it won't re-fire on a re-render
  // at the same streak, and resets when the streak breaks (drops).
  const [milestone, setMilestone] = useState(0);
  const lastCelebratedRef = useRef(0);
  useEffect(() => {
    const s = sessionStats.streak;
    if (s > 0 && s % 5 === 0 && s !== lastCelebratedRef.current) {
      lastCelebratedRef.current = s;
      setMilestone(s);
      const t = window.setTimeout(() => setMilestone(0), 1500);
      return () => window.clearTimeout(t);
    }
    if (s < lastCelebratedRef.current) lastCelebratedRef.current = 0;
  }, [sessionStats.streak]);

  // --- backend practice session wiring (best-effort telemetry) ---
  // We hold the live session id + running tally in refs so the
  // start/end calls stay outside React's render cycle and never block
  // or break the drill. The end call rolls the tally into daily_activity,
  // which is what flips has_any_activity and brings the dashboard's
  // streak / calendar / daily-goal to life.
  const sessionIdRef = useRef<string | null>(null);
  const tallyRef = useRef({ attempted: 0, correct: 0 });

  // Initial load: lesson + progress + first pick.
  //
  // Phase 3.1: if ?sentence=Y is present and matches a sentence in
  // the loaded lib, render that exact step instead of drawing from
  // pickNextStep. The `?sentence=` query param is then scrubbed via
  // history.replaceState so a refresh doesn't lock the user on the
  // same sentence (the user is in a drill loop, not a deep-link
  // context). `?lib=` is preserved — reloading in the same lib is
  // an honest thing to do, unlike reloading on the same sentence.
  //
  // If ?sentence=Y doesn't match anything in the lib (hand-typed URL,
  // stale link, etc.) we silently fall through to pickNextStep
  // instead of bailing — the URL is informational, the drill should
  // still work.
  useEffect(() => {
    let cancelled = false;
    const readUrlSentence = (): string | null => {
      if (typeof window === 'undefined') return null;
      const params = new URLSearchParams(window.location.search);
      return params.get('sentence');
    };
    const scrubUrlSentence = () => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (url.searchParams.has('sentence')) {
        url.searchParams.delete('sentence');
        const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') + url.hash;
        window.history.replaceState({}, '', next);
      }
    };
    // Reset guest trigger state on libId change (new session).
    setSessionStats({ total: 0, correct: 0, streak: 0, maxStreak: 0, startTime: Date.now() });
    setLastResult(null);
    setCardState({
      improvedCardShown: false,
      rateCardShown: false,
      dismissedThisSession: false,
    });
    setActiveHint(null);
    (async () => {
      try {
        const [l, p] = await Promise.all([
          getLib(libId),
          Promise.resolve(loadTranslationProgress(userId)),
        ]);
        if (cancelled) return;
        setLesson(l);
        setProgress(p);

        const targetSentenceId = readUrlSentence();
        const first =
          (targetSentenceId && pickStepBySentenceId(l, targetSentenceId)) ||
          pickNextStep(l, p, libId);

        if (!first) {
          setSessionState('empty-lib');
        } else {
          setCurrentStep(first);
          setSessionState('running');
          // Scrub AFTER setCurrentStep so a re-render in the same
          // tick still sees the correct step. The user has now
          // landed on a real drill screen; the URL should reflect
          // that ("I'm in lib X") rather than the navigation intent
          // ("go to sentence Y").
          if (targetSentenceId) scrubUrlSentence();
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
    // libId + userId are the meaningful deps; pickNextStep /
    // pickStepBySentenceId are stable and read from the latest
    // lesson/progress via closure on `l`/`p`. userId matters when
    // the user signs out + signs in as a different account: the
    // next mount needs to load the new account's progress.
  }, [libId, userId]);

  // Start a backend practice session once the drill is actually running
  // (lesson loaded) and the user is signed in. End it on unmount or
  // when the lib / account changes — an unbounded drill has no other
  // "finish" signal. We skip the end call when nothing was attempted
  // (attempted === 0 would otherwise upsert a 0-row into daily_activity
  // and falsely mark the user as "practiced").
  useEffect(() => {
    if (isGuest || sessionState !== 'running') return;
    let active = true;
    startPracticeSession({ lib_id: libId })
      .then(({ session_id }) => {
        if (!active) {
          // Torn down before start resolved (fast lib switch / unmount).
          // End the orphan so it doesn't dangle unfinished.
          endPracticeSession(
            session_id,
            tallyRef.current.attempted,
            tallyRef.current.correct,
          ).catch(() => {});
          return;
        }
        sessionIdRef.current = session_id;
        tallyRef.current = { attempted: 0, correct: 0 };
      })
      .catch(() => {
        // best-effort: if start fails we simply don't track this session
        sessionIdRef.current = null;
      });
    return () => {
      active = false;
      const sid = sessionIdRef.current;
      if (sid && tallyRef.current.attempted > 0) {
        sessionIdRef.current = null;
        endPracticeSession(
          sid,
          tallyRef.current.attempted,
          tallyRef.current.correct,
        ).catch(() => {});
      }
    };
  }, [isGuest, sessionState, libId]);

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
      //
      // Wrong-book fields (Phase 2): on a wrong answer, bump
      // wrongCount (init to 1) and stamp lastWrongAt = Date.now().
      // On a correct answer we PRESERVE wrongCount / lastWrongAt —
      // they live as history even after the sentence leaves the
      // "wrong" bucket, so a future Me-page error book can show
      // "错了 N 次" and "最近错 2 小时前" for a sentence the user
      // has since mastered. The wrong bucket itself is governed
      // solely by `correct` (see bucketFor below).
      const libBucket = progress[libId] ?? { sentences: {} };
      const sentencesBucket = libBucket.sentences ?? {};
      const prev = sentencesBucket[sentenceId];
      const now = Date.now();
      const updatedSentence: TranslationSentenceProgress = correct
        ? {
            correct: true,
            // Carry forward the wrong-history if any. First-ever
            // answer being correct has no prior, so fall back to 0.
            wrongCount: prev?.wrongCount ?? 0,
            lastWrongAt: prev?.lastWrongAt,
          }
        : {
            correct: false,
            wrongCount: (prev?.wrongCount ?? 0) + 1,
            lastWrongAt: now,
          };
      const nextProgress: TranslationProgress = {
        ...progress,
        [libId]: {
          ...libBucket,
          sentences: { ...sentencesBucket, [sentenceId]: updatedSentence },
        },
      };
      setProgress(nextProgress);
      saveTranslationProgress(nextProgress, userId);

      // --- backend practice telemetry (signed-in users only) ---
      // Tally the attempt and stream the per-step outcome. recordPracticeStep
      // is fire-and-forget; it only matters that the /end call (on unmount /
      // lib switch) carries the authoritative totals. Guests have no
      // session_id, so this is a no-op for them.
      tallyRef.current.attempted += 1;
      if (correct) tallyRef.current.correct += 1;
      const sid = sessionIdRef.current;
      if (sid) recordPracticeStep(sid, correct, sentenceId);

      // Notify same-tab listeners that progress changed. The native
      // `storage` event only fires across tabs/windows — same-tab
      // writes don't trigger it. MePage listens for this event so
      // its "错题本 N" tab badge updates the moment the user
      // answers, even if they stay on the practice page and come
      // back via the avatar later. Bubbling is irrelevant (this
      // fires on window) but cancelable=true lets a future test
      // or middleware swallow the notification.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('translation-progress-changed', {
            detail: { libId, sentenceId, correct },
          }),
        );
      }

      // Update run stats for everyone (drives the live HUD + end-of-session
      // summary). Streak resets on a wrong/skipped answer, climbs on correct.
      setSessionStats((prev) => {
        const attempted = prev.total + 1;
        const correctN = prev.correct + (correct ? 1 : 0);
        const streak = correct ? prev.streak + 1 : 0;
        const maxStreak = Math.max(prev.maxStreak, streak);
        return { ...prev, total: attempted, correct: correctN, streak, maxStreak };
      });

      // Guest-only: evaluate hint triggers. Use the *current* lastResult
      // (closure) + the closure sessionStats for the rate threshold so we
      // see this answer. Signed-in users skip the nudges.
      if (isGuest) {
        const previousResult = lastResult;
        const newTotal = sessionStats.total + 1;
        const newCorrect =
          sessionStats.correct + (correct ? 1 : 0);
        setLastResult(correct ? 'correct' : 'wrong');

        // Skip API: skipped counts as wrong, never triggers improved.
        // (TranslationStage already routes skip through onComplete(false))
        const cardAvailable =
          !cardState.improvedCardShown &&
          !cardState.rateCardShown &&
          !cardState.dismissedThisSession;

        // "改进" card only fires when there IS a previous result and
        // it was not correct. The very first answer of a session has
        // previousResult=null; that's not "improvement", that's just
        // a first answer.
        if (
          cardAvailable &&
          previousResult != null &&
          previousResult !== 'correct' &&
          correct
        ) {
          setActiveHint('improved');
          setCardState((prev) => ({ ...prev, improvedCardShown: true }));
        } else if (
          cardAvailable &&
          newTotal >= 5 &&
          newCorrect / newTotal >= 0.8
        ) {
          setActiveHint('rate');
          setCardState((prev) => ({ ...prev, rateCardShown: true }));
        }
      }

      // Draw the next step using the freshly-written progress so a
      // self-corrected step doesn't immediately re-surface.
      const next = pickNextStep(lesson, nextProgress, libId);
      setCurrentStep(next);
      if (!next) setSessionState('empty-lib');
    },
    [progress, libId, lesson, currentStep, isGuest, lastResult, sessionStats, cardState, userId]
  );

  const handleHintLogin = useCallback(() => {
    const from = `${window.location.pathname}${window.location.search}`;
    openAuthModal('login', { from });
  }, [openAuthModal]);

  const handleHintDismiss = useCallback(() => {
    setActiveHint(null);
    setCardState((prev) => ({ ...prev, dismissedThisSession: true }));
  }, []);

  // Restart the drill in place — fresh run stats, re-draw the first step
  // from the current progress. The backend session keeps rolling (no
  // end call) so the cumulative tally is preserved until unmount.
  const handleRestart = () => {
    setSessionStats({ total: 0, correct: 0, streak: 0, maxStreak: 0, startTime: Date.now() });
    setLastResult(null);
    const first = lesson ? pickNextStep(lesson, progress, libId) : null;
    setCurrentStep(first);
    setSessionState(first ? 'running' : 'empty-lib');
  };

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
      <div className={`${styles.translation} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }

  if (sessionState === 'error') {
    return (
      <div className={`${styles.translation} ${styles.errorVariant}`}>
        <p className={styles.errorText}>{error}</p>
        <SpecularButton
          size="sm"
          onClick={onBack}
          tint="var(--ds-action)"
          tintOpacity={0.18}
          baseColor="transparent"
          lineColor="var(--ds-action-deep)"
          textColor="var(--ds-action-deep)"
          blur={6}
          intensity={0.6}
          followMouse
          proximity={220}
        >
          返回
        </SpecularButton>
      </div>
    );
  }

  if (sessionState === 'empty-lib' || !currentStep) {
    return (
      <div className={`${styles.translation} ${styles.emptyStep}`}>
        <span className={styles.emptyKicker}>本词库</span>
        <p className={styles.emptyText}>
          该词库暂无可练习的句子
        </p>
        <div className={styles.actions}>
          <SpecularButton
          size="md"
          onClick={onBack}
          tint="var(--ds-action-deep)"
          tintOpacity={1}
          baseColor="var(--ds-action-deep)"
          lineColor="var(--ds-on-action)"
          textColor="var(--ds-on-action)"
          blur={6}
          intensity={1.0}
          followMouse
          proximity={260}
        >
          返回词库列表
        </SpecularButton>
        </div>
      </div>
    );
  }

  if (sessionState === 'finished') {
    const acc = sessionStats.total
      ? Math.round((sessionStats.correct / sessionStats.total) * 100)
      : 0;
    const secs = Math.max(0, Math.round((Date.now() - sessionStats.startTime) / 1000));
    return (
      <div className={`${styles.translation} ${styles.finished}`}>
        <span className={styles.emptyKicker}>练习完成</span>
        <h2 className={styles.endTitle}>本轮练习结束</h2>
        <div className={styles.endStats}>
          <Stat value={sessionStats.total} label="练习句数" />
          <Stat value={`${acc}%`} label="正确率" tone="mint" />
          <Stat value={sessionStats.maxStreak} label="最长连击" tone="mint" />
          <Stat value={formatDuration(secs)} label="用时" />
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="md" onClick={handleRestart}>
            再来一组
          </Button>
          <Button variant="ghost" size="md" onClick={onBack}>
            返回词库
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {stats && (
        <div className={styles.topProgress} aria-hidden>
          <div
            className={styles.topProgressFill}
            style={{
              width: `${Math.round((stats.answered / stats.total) * 100)}%`,
            }}
          />
        </div>
      )}
      <div className={styles.hud}>
        <div className={styles.hudStats}>
          <Stat value={sessionStats.total} label="已练" />
          <Stat
            value={
              sessionStats.total
                ? `${Math.round((sessionStats.correct / sessionStats.total) * 100)}%`
                : '0%'
            }
            label="正确率"
            tone={
              sessionStats.total && sessionStats.correct / sessionStats.total >= 0.8
                ? 'mint'
                : 'ink'
            }
          />
          <Stat value={sessionStats.streak} label="连击" tone="mint" />
          <Stat value={formatDuration(elapsedSecs)} label="用时" />
        </div>
        <button
          type="button"
          className={styles.endBtn}
          onClick={() => setSessionState('finished')}
        >
          结束练习
        </button>
      </div>
      <TranslationStage
        sentence={currentStep.sentence}
        targetWord={currentStep.word}
        onComplete={handleStepComplete}
      />
      {milestone > 0 && (
        <div className={styles.milestone} aria-hidden>
          连击 {milestone}！
        </div>
      )}
      {stats && (
        <p className={styles.meta} aria-label="练习进度">
          已答 {stats.answered} / {stats.total} 句 ({stats.percent}%)
          {' · '}
          本词 {currentWordAnswered} 句
        </p>
      )}
      {activeHint && (
        <PracticeHintCard
          kind={activeHint}
          onLogin={handleHintLogin}
          onDismiss={handleHintDismiss}
        />
      )}
    </>
  );
}