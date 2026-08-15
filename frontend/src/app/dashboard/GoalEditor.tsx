'use client';

/**
 * GoalEditor — edit the user's daily + monthly sentence targets.
 *
 * Daily goal: writes via POST /api/dashboard/daily-goal (new in this
 * console refactor — the backend previously only exposed monthly).
 * Monthly goal: writes via POST /api/dashboard/monthly-goal (endpoint
 * already existed; the old dashboard simply never called it — this is
 * where it finally gets wired up).
 *
 * Both fields are controlled locally with a small "保存" affordance and
 * preset chips; on success the parent's on*Saved callback bubbles the
 * fresh state back up so the rest of the console (greeting bar, daily
 * ring) reflects the change immediately.
 */

import { useState } from 'react';
import {
  DailyGoalState,
  MonthlyGoalInfo,
  updateDailyGoal,
  updateMonthlyGoal,
} from '../api';
import styles from './GoalEditor.module.css';

interface GoalEditorProps {
  dailyGoal: DailyGoalState;
  monthlyGoal: MonthlyGoalInfo;
  onDailySaved: (state: DailyGoalState) => void;
  onMonthlySaved: (info: MonthlyGoalInfo) => void;
}

const DAILY_PRESETS = [10, 20, 30, 50];
const MONTHLY_PRESETS = [200, 500, 1000, 2000];

export default function GoalEditor({
  dailyGoal,
  monthlyGoal,
  onDailySaved,
  onMonthlySaved,
}: GoalEditorProps) {
  const [dailyDraft, setDailyDraft] = useState<number>(dailyGoal.target);
  const [monthlyDraft, setMonthlyDraft] = useState<number>(monthlyGoal.target);
  const [saving, setSaving] = useState<'daily' | 'monthly' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveDaily = async () => {
    const value = Math.max(1, Math.min(100000, Math.round(dailyDraft)));
    if (value === dailyGoal.target) return;
    setSaving('daily');
    setError(null);
    try {
      const next = await updateDailyGoal(value);
      onDailySaved(next);
      setDailyDraft(next.target);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const saveMonthly = async () => {
    const value = Math.max(1, Math.min(100000, Math.round(monthlyDraft)));
    if (value === monthlyGoal.target) return;
    setSaving('monthly');
    setError(null);
    try {
      const next = await updateMonthlyGoal(value);
      onMonthlySaved(next);
      setMonthlyDraft(next.target);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className={styles.root} aria-label="练习目标">
      <div className={styles.header}>
        <h2 className={styles.heading}>练习目标</h2>
        <p className={styles.sub}>设定每天的练习量,养成稳定节奏。</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.block}>
          <label className={styles.label} htmlFor="daily-goal-input">
            每日目标
            <span className={styles.hint}>
              （今日已完成 {dailyGoal.today_count} / {dailyGoal.target} 句）
            </span>
          </label>
          <div className={styles.row}>
            <input
              id="daily-goal-input"
              className={styles.input}
              type="number"
              min={1}
              max={100000}
              value={Number.isFinite(dailyDraft) ? dailyDraft : ''}
              onChange={(e) => setDailyDraft(Number(e.target.value))}
              aria-label="每日目标句数"
            />
            <span className={styles.unit}>句 / 天</span>
            <button
              type="button"
              className={styles.save}
              onClick={() => void saveDaily()}
              disabled={saving !== null || dailyDraft === dailyGoal.target}
            >
              {saving === 'daily' ? '保存中…' : '保存'}
            </button>
          </div>
          <div className={styles.presets} role="group" aria-label="每日目标快捷选项">
            {DAILY_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.chip}
                data-active={dailyDraft === p ? 'true' : 'false'}
                onClick={() => setDailyDraft(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.block}>
          <label className={styles.label} htmlFor="monthly-goal-input">
            每月目标
            <span className={styles.hint}>
              （本月已完成 {monthlyGoal.current} / {monthlyGoal.target} 天）
            </span>
          </label>
          <div className={styles.row}>
            <input
              id="monthly-goal-input"
              className={styles.input}
              type="number"
              min={1}
              max={100000}
              value={Number.isFinite(monthlyDraft) ? monthlyDraft : ''}
              onChange={(e) => setMonthlyDraft(Number(e.target.value))}
              aria-label="每月目标天数"
            />
            <span className={styles.unit}>天 / 月</span>
            <button
              type="button"
              className={styles.save}
              onClick={() => void saveMonthly()}
              disabled={saving !== null || monthlyDraft === monthlyGoal.target}
            >
              {saving === 'monthly' ? '保存中…' : '保存'}
            </button>
          </div>
          <div className={styles.presets} role="group" aria-label="每月目标快捷选项">
            {MONTHLY_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.chip}
                data-active={monthlyDraft === p ? 'true' : 'false'}
                onClick={() => setMonthlyDraft(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
