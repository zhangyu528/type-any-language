'use client';

/**
 * GoalEditor — edit the user's daily sentence target.
 *
 * Daily goal: writes via POST /api/dashboard/daily-goal. The state is
 * controlled locally with a small "保存" affordance and preset chips; on
 * success the parent's onDailySaved callback bubbles the fresh state back
 * up so the rest of the console (greeting bar, daily ring) reflects the
 * change immediately.
 *
 * The monthly target was removed from this editor — it is fully derivable
 * from the daily cadence (daily × days) and keeping a separate monthly
 * input was redundant. Monthly progress is still shown read-only in the
 * greeting bar / overview.
 */

import { useState } from 'react';
import { DailyGoalState, updateDailyGoal } from '../api';
import styles from './GoalEditor.module.css';

interface GoalEditorProps {
  dailyGoal: DailyGoalState;
  onDailySaved: (state: DailyGoalState) => void;
}

const DAILY_PRESETS = [10, 20, 30, 50];

export default function GoalEditor({ dailyGoal, onDailySaved }: GoalEditorProps) {
  const [dailyDraft, setDailyDraft] = useState<number>(dailyGoal.target);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const saveDaily = async () => {
    const value = Math.max(1, Math.min(100000, Math.round(dailyDraft)));
    if (value === dailyGoal.target) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateDailyGoal(value);
      onDailySaved(next);
      setDailyDraft(next.target);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.root} aria-label="练习目标">
      <div className={styles.header}>
        <h2 className={styles.heading}>练习目标</h2>
        <p className={styles.sub}>设定每天的练习量,养成稳定节奏。</p>
      </div>

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
            disabled={saving || dailyDraft === dailyGoal.target}
          >
            {saving ? '保存中…' : '保存'}
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

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
