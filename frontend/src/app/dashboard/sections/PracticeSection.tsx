'use client';

/**
 * PracticeSection — the "练习" partition of the console.
 *
 * Surfaces the full lib catalog as a persistent grid (reusing the
 * existing LibPicker list logic — its "继续上次" + grid rendering) and
 * embeds the GoalEditor for tuning daily / monthly targets. Differs
 * from the overview's picker modal: here the libs are always visible
 * (a control-room surface), not hidden behind a CTA.
 */

import { Catalog, DailyGoalState, MonthlyGoalInfo } from '../../api';
import LibPicker from '../LibPicker';
import GoalEditor from '../GoalEditor';
import styles from './PracticeSection.module.css';

interface PracticeSectionProps {
  catalog: Catalog;
  onPickLib: (libId: string) => void;
  onStartPractice: () => void;
  dailyGoal: DailyGoalState;
  monthlyGoal: MonthlyGoalInfo;
  onDailySaved: (state: DailyGoalState) => void;
  onMonthlySaved: (info: MonthlyGoalInfo) => void;
}

export default function PracticeSection({
  catalog,
  onPickLib,
  onStartPractice,
  dailyGoal,
  monthlyGoal,
  onDailySaved,
  onMonthlySaved,
}: PracticeSectionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.libBlock}>
        <div className={styles.header}>
          <h2 className={styles.heading}>选择词库</h2>
          <p className={styles.sub}>挑一个词库开始,或继续上次的练习。</p>
          <button
            type="button"
            className={styles.quickStart}
            onClick={onStartPractice}
          >
            快速开始 →
          </button>
        </div>
        <LibPicker libs={catalog.libs} onPick={onPickLib} />
      </div>

      <GoalEditor
        dailyGoal={dailyGoal}
        monthlyGoal={monthlyGoal}
        onDailySaved={onDailySaved}
        onMonthlySaved={onMonthlySaved}
      />
    </div>
  );
}
