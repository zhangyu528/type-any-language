'use client';

/**
 * DailyGoal — today's progress toward the user's daily target.
 *
 * Uses the DS ProgressRing (the only ring component the design system
 * ships) and animates the count up from 0 on mount via useCountUp.
 *
 * When the goal is hit we swap the copy from "X left" to "🎉 daily
 * goal hit" — the user has earned a moment of celebration. The
 * ProgressRing stays at 100% fill (no clipping past the target).
 *
 * The CTA is a SpecularButton with the slate `--ds-action` fill
 * (vs ContinueCard's amber `--ds-cta`); the color split keeps the
 * two cards visually distinct while still using the same primary
 * action pattern.
 */

import ProgressRing from '../ds/components/ProgressRing';
import { DailyGoalState } from '../api';
import { SpecularButton } from '@/components/effects';
import { useCountUp } from '../me/useCountUp';
import styles from './DailyGoal.module.css';

export interface DailyGoalProps {
  state: DailyGoalState;
  /**
   * CTA handler — opens the dashboard's in-place lib picker (or
   * jumps straight into the last-used lib when prefs.libId is set).
   * Parent owns routing so this card stays router-agnostic.
   */
  onStartPractice: () => void;
}

export default function DailyGoal({ state, onStartPractice }: DailyGoalProps) {
  // Animate only today's count, not the target. Target is shown as
  // a static "/ 20" suffix so the user always sees the goal.
  const [shown] = useCountUp(state.today_count);
  const pct = Math.round(state.pct * 100);

  return (
    <section className={styles.root} aria-label="daily goal">
      <p className={styles.caption}>Daily Goal</p>
      <div className={styles.row}>
        <ProgressRing
          percent={pct}
          size={64}
          strokeWidth={6}
          ariaLabel={`今日 ${shown} / ${state.target} 句,完成度 ${pct}%`}
        />
        <div className={styles.numbers}>
          <span className={styles.count}>{shown}</span>
          <span className={styles.divider}>/</span>
          <span className={styles.target}>{state.target}</span>
        </div>
      </div>
      <p className={styles.copy}>
        {state.completed ? '🎉 Daily goal hit' : `${state.target - shown} more today`}
      </p>
      {!state.completed ? (
        /* SpecularButton (slate action) — same visual tuning as
           ContinueCard: intensity 1.5 + proximity 480 + outer-glow
           so it reads as "premium" at rest, not just on hover. */
        <SpecularButton
          size="md"
          onClick={onStartPractice}
          radius={14}
          tint="#378ADD"
          tintOpacity={1}
          textColor="#FFFFFF"
          lineColor="#FFFFFF"
          baseColor="#1F5A99"
          blur={8}
          intensity={1.5}
          shineSize={14}
          shineFade={50}
          followMouse
          proximity={480}
          className={styles.cta}
        >
          Practice now
        </SpecularButton>
      ) : null}
    </section>
  );
}