'use client';

/**
 * SettingsSection — the "设置" partition of the console.
 *
 * GoalEditor (daily practice target) lives here, so this is where users
 * tune their cadence. SettingsTab (theme / audio rate / difficulty /
 * phonetics / logout / reset) is reused verbatim from /me — the console
 * owns settings UI now, so /me redirects in here.
 */

import SettingsTab from '../../me/SettingsTab';
import GoalEditor from '../GoalEditor';
import { DailyGoalState } from '../../api';
import styles from './SettingsSection.module.css';

interface SettingsSectionProps {
  dailyGoal: DailyGoalState;
  onDailySaved: (state: DailyGoalState) => void;
}

export default function SettingsSection({
  dailyGoal,
  onDailySaved,
}: SettingsSectionProps) {
  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>设置</p>
          <h1 className={styles.title}>偏好与账号</h1>
          <p className={styles.subtitle}>
            调好每天的练习量,再按喜好微调音频、难度与显示方式。
          </p>
        </div>
      </header>
      <GoalEditor dailyGoal={dailyGoal} onDailySaved={onDailySaved} />
      <SettingsTab />
    </div>
  );
}
