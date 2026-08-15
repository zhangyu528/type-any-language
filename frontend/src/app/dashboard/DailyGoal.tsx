'use client';

/**
 * DailyGoal — today's progress toward the user's daily target.
 *
 * Pure status display only: the ProgressRing (count-up animated) plus the
 * "X / target" readout and a one-line copy ("还差 N 句" / "今日目标达成").
 * It intentionally ships NO button — the overview's single primary action
 * lives in ContinueCard (left half of the 今日 panel), so two competing
 * CTAs never sit in the same panel.
 */

import ProgressRing from '../ds/components/ProgressRing';
import { DailyGoalState } from '../api';
import { useCountUp } from '../me/useCountUp';
import styles from './DailyGoal.module.css';

export interface DailyGoalProps {
  state: DailyGoalState;
}

export default function DailyGoal({ state }: DailyGoalProps) {
  const [shown] = useCountUp(state.today_count);
  const pct = Math.round(state.pct * 100);

  return (
    <section className={styles.root} aria-label="每日目标">
      <p className={styles.caption}>每日目标</p>
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
      <p className={`${styles.copy} ${state.completed ? styles.copyDone : ''}`}>
        {state.completed ? '今日目标达成' : `还差 ${state.target - shown} 句`}
      </p>
    </section>
  );
}
