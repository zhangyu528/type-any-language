'use client';

/**
 * DayDetailDrawer — right-side panel that opens when the user clicks
 * a calendar cell.
 *
 * Fetches GET /api/dashboard/day/{date} on mount, shows a small KPI
 * strip + a per-session list. Closing the drawer unmounts the
 * component (no caching in v1 — re-opens are cheap and rare).
 *
 * Desktop: fixed right panel, 40% viewport width.
 * Mobile:  bottom sheet, ~70vh, drag-handle aesthetic is overkill for
 * v1 — we just snap to the bottom.
 */

import { useEffect, useState } from 'react';
import { DayDetail, getDayDetail } from '../api';
import styles from './DayDetailDrawer.module.css';

export interface DayDetailDrawerProps {
  date: string;
  onClose: () => void;
}

export default function DayDetailDrawer({ date, onClose }: DayDetailDrawerProps) {
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getDayDetail(date);
        if (cancelled) return;
        setDetail(d);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Esc closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const accuracyPct = detail && detail.accuracy != null
    ? Math.round(detail.accuracy * 100)
    : null;

  return (
    <>
      <div
        className={styles.scrim}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={styles.drawer}
        role="dialog"
        aria-label={`${date} 当天详情`}
      >
        <header className={styles.head}>
          <p className={styles.date}>{date}</p>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {!detail && !error ? <p className={styles.loading}>加载中…</p> : null}

        {detail ? (
          <>
            <div className={styles.kpis}>
              <div className={styles.kpi}>
                <span className={styles.kpiValue}>{detail.sentences_count}</span>
                <span className={styles.kpiLabel}>句</span>
              </div>
              <div className={styles.kpi}>
                <span className={styles.kpiValue}>
                  {accuracyPct != null ? `${accuracyPct}%` : '—'}
                </span>
                <span className={styles.kpiLabel}>准确率</span>
              </div>
              <div className={styles.kpi}>
                <span className={styles.kpiValue}>
                  {detail.goal_hit ? '✓' : '—'}
                </span>
                <span className={styles.kpiLabel}>达标</span>
              </div>
            </div>

            <h3 className={styles.sessionsTitle}>Sessions</h3>
            {detail.sessions.length === 0 ? (
              <p className={styles.empty}>当天没有 session</p>
            ) : (
              <ul className={styles.sessions}>
                {detail.sessions.map((s) => (
                  <li key={s.session_id} className={styles.session}>
                    <span className={styles.sessionTime}>
                      {new Date(s.started_at).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className={styles.sessionMeta}>
                      {s.sentences_attempted} 句 ·{' '}
                      {s.sentences_correct} 对
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </aside>
    </>
  );
}