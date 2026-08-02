'use client';

/**
 * /dashboard — login-required workbench page.
 *
 * Layout (top → bottom, mobile collapses the first row):
 *   ┌──────────────────────────────────────────────────┐
 *   │ GreetingBar       (Streak header + avatar)       │
 *   ├────────────────────┬─────────────────────────────┤
 *   │ ContinueCard       │ DailyGoal                   │
 *   ├────────────────────┴─────────────────────────────┤
 *   │ WeeklyCalendar   (4-week grid)                   │
 *   ├──────────────────────────────────────────────────┤
 *   │ ProgressSnapshot  (Accuracy · Sentences · Words) │
 *   └──────────────────────────────────────────────────┘
 *
 * Auth: same pattern as /me/page.tsx — useAuth() + redirect to
 * /login?from=/dashboard if anonymous. The dashboard never calls
 * the backend anonymously.
 *
 * Data: GET /api/dashboard is the single hydration call. Subsequent
 * refreshes (e.g. after the user finishes a session elsewhere) just
 * re-fetch the same endpoint; no incremental hydration state to
 * manage in v1.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

import {
  DashboardSnapshot,
  getDashboardSnapshot,
} from '../api';
import { useAuth } from '../lib/auth';
import LoadingMark from '../components/LoadingMark';

import GreetingBar from './GreetingBar';
import ContinueCard from './ContinueCard';
import DailyGoal from './DailyGoal';
import WeeklyCalendar from './WeeklyCalendar';
import ProgressSnapshot from './ProgressSnapshot';
import styles from './Dashboard.module.css';

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardLoading() {
  return (
    <div className={styles.loading}>
      <LoadingMark />
      <p className={styles.loadingText}>Loading…</p>
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();

  // Auth gate — mirror /me/page.tsx verbatim. The redirect target
  // uses the live pathname so back-nav after login lands the user
  // back on /dashboard.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const here = pathname || '/dashboard';
      router.replace(`/login?from=${encodeURIComponent(here)}`);
    }
  }, [authLoading, user, router, pathname]);

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the dashboard. Re-runs when the user identity flips (login
  // → logout transitions) so anonymous sessions never see stale data.
  const loadSnapshot = useCallback(async () => {
    try {
      const s = await getDashboardSnapshot();
      setSnapshot(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'dashboard 加载失败');
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getDashboardSnapshot();
        if (cancelled) return;
        setSnapshot(s);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'dashboard 加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  if (authLoading || !user) return <DashboardLoading />;

  if (error) {
    return (
      <div className={styles.errorWrap}>
        <p className={styles.errorText}>{error}</p>
        <button
          type="button"
          className={styles.errorRetry}
          onClick={() => {
            setError(null);
            void loadSnapshot();
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!snapshot) return <DashboardLoading />;

  return (
    <main className={styles.root}>
      <GreetingBar
        user={snapshot.user}
        streak={snapshot.streak}
        dailyGoal={snapshot.daily_goal}
      />
      <div className={styles.row}>
        <ContinueCard state={snapshot.continue} />
        <DailyGoal state={snapshot.daily_goal} />
      </div>
      <WeeklyCalendar
        days={snapshot.calendar}
        monthlyGoal={snapshot.monthly_goal}
      />
      <ProgressSnapshot kpis={snapshot.progress} />
    </main>
  );
}