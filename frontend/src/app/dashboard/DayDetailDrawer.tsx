'use client';

/**
 * DayDetailDrawer — right-side panel that opens when the user clicks
 * a calendar cell.
 *
 * Fetches GET /api/dashboard/day/{date} on mount, shows a small KPI
 * strip + a per-session list. Closing the drawer unmounts the
 * component (no caching in v1 — re-opens are cheap and rare).
 *
 * Animation (motion/react):
 *   - mount: scrim fade-in + drawer slide from right (380ms ease-out)
 *   - unmount: same in reverse (handled by AnimatePresence in parent)
 *   - KPI numbers roll up via AnimatedCounter when detail loads
 *   - session list cascades in via motion stagger
 *
 * Desktop: fixed right panel, 40% viewport width.
 * Mobile:  bottom sheet, ~70vh, drag-handle aesthetic is overkill for
 * v1 — we just snap to the bottom.
 */

import Counter from '@/components/Counter';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { DayDetail, getDayDetail } from '../api';
import { riseIn, staggerParent } from '../ds/motion';
import { formatFullCn } from './calendarDate';
import styles from './DayDetailDrawer.module.css';

export interface DayDetailDrawerProps {
  date: string;
  onClose: () => void;
}

export default function DayDetailDrawer({ date, onClose }: DayDetailDrawerProps) {
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mobile detection: <640px uses bottom-sheet (slide up via y),
  // desktop uses right-panel (slide in via x). Set on mount via
  // matchMedia; updated on viewport changes.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

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
      {/* Scrim fades in/out; click closes the drawer. */}
      <motion.div
        className={styles.scrim}
        onClick={onClose}
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      />
      {/* Drawer slides in from the right on desktop, or up from the
          bottom on mobile (the CSS repositions to bottom-sheet <640px,
          we just match the direction). Reverse on exit. */}
      <motion.aside
        className={styles.drawer}
        role="dialog"
        aria-label={`${formatFullCn(date)} 当天详情`}
        initial={isMobile ? { y: '100%' } : { x: '100%' }}
        animate={isMobile ? { y: 0 } : { x: 0 }}
        exit={isMobile ? { y: '100%' } : { x: '100%' }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className={styles.head}>
          <p className={styles.date}>{formatFullCn(date)}</p>
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
          <motion.div
            // KPI + sessions 整体 stagger 入场,detail 加载完才触发
            // (initial=hidden 默认,等 detail 出现 → 改 animate=show)
            variants={staggerParent}
            initial="hidden"
            animate="show"
          >
            <div className={styles.kpis}>
              <motion.div className={styles.kpi} variants={riseIn}>
                <span className={styles.kpiValue}>
                  <Counter value={detail.sentences_count} fontSize={40} className={styles.kpiCounter} />
                </span>
                <span className={styles.kpiLabel}>句</span>
              </motion.div>
              <motion.div className={styles.kpi} variants={riseIn}>
                <span className={styles.kpiValue}>
                  {accuracyPct != null ? (
                    <>
                      <Counter value={accuracyPct} fontSize={40} className={styles.kpiCounter} />
                      <span aria-hidden>%</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className={styles.kpiLabel}>准确率</span>
              </motion.div>
              <motion.div className={styles.kpi} variants={riseIn}>
                <span className={styles.kpiValue}>
                  {detail.goal_hit ? '✓' : '—'}
                </span>
                <span className={styles.kpiLabel}>达标</span>
              </motion.div>
            </div>

            <motion.h3 className={styles.sessionsTitle} variants={riseIn}>
              Sessions
            </motion.h3>
            {detail.sessions.length === 0 ? (
              <motion.p className={styles.empty} variants={riseIn}>
                当天没有 session
              </motion.p>
            ) : (
              <motion.ul
                className={styles.sessions}
                variants={staggerParent}
              >
                {detail.sessions.map((s) => (
                  <motion.li
                    key={s.session_id}
                    className={styles.session}
                    variants={riseIn}
                  >
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
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </motion.div>
        ) : null}
      </motion.aside>
    </>
  );
}