'use client';

/**
 * SettingsSection — the "设置" partition of the console.
 *
 * GoalEditor (daily + monthly practice targets) moved here from the 课程
 * partition, so this is where users tune their cadence. SettingsTab (theme /
 * audio rate / difficulty / phonetics / logout / reset) is reused verbatim
 * from /me — the console owns settings UI now, so /me redirects in here.
 */

import SettingsTab from '../../me/SettingsTab';
import GoalEditor from '../GoalEditor';
import { DailyGoalState, MonthlyGoalInfo } from '../../api';
import styles from './SettingsSection.module.css';

interface SettingsSectionProps {
  dailyGoal: DailyGoalState;
  monthlyGoal: MonthlyGoalInfo;
  onDailySaved: (state: DailyGoalState) => void;
  onMonthlySaved: (info: MonthlyGoalInfo) => void;
}

export default function SettingsSection({
  dailyGoal,
  monthlyGoal,
  onDailySaved,
  onMonthlySaved,
}: SettingsSectionProps) {
  return (
    <div className={styles.root}>
      <GoalEditor
        dailyGoal={dailyGoal}
        monthlyGoal={monthlyGoal}
        onDailySaved={onDailySaved}
        onMonthlySaved={onMonthlySaved}
      />
      <SettingsTab />
    </div>
  );
}
