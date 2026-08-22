'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import LoadingMark from '../components/LoadingMark';
import TranslationSession from '../TranslationSession';
import { useAuth } from '../lib/auth';
import styles from './Practice.module.css';

/**
 * Standalone practice route. Dashboard chooses the library, but the drill
 * owns the full page so its layout is not constrained by dashboard cards.
 */
export default function PracticeRoute() {
  return (
    <Suspense fallback={<PracticeLoading />}>
      <PracticeRouteInner />
    </Suspense>
  );
}

function PracticeLoading() {
  return (
    <main className={`${styles.root} ${styles.loading}`}>
      <LoadingMark />
      <p className={styles.loaderText}>Loading…</p>
    </main>
  );
}

function PracticeRouteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const libId = params.get('lib');

  useEffect(() => {
    if (!authLoading && !user) {
      const from = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?from=${encodeURIComponent(from)}`);
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (libId) {
      try {
        window.localStorage.setItem('prefs.libId', libId);
      } catch {
        /* 隐私模式静默 */
      }
    }
  }, [libId]);

  // 练习入口统一从 /dashboard 进入；landing 选词直接跳到本路由(`/practice`)，
  // 与 dashboard 走同一路径，所以 returnTo 固定为 /dashboard。
  const returnTo = '/dashboard';

  if (authLoading || !user) return <PracticeLoading />;
  if (!libId) {
    router.replace(returnTo);
    return <PracticeLoading />;
  }

  return (
    <main className={styles.root} data-babyblue>
      <div className={styles.content}>
        <TranslationSession
          libId={libId}
          onBack={() => router.push(returnTo)}
        />
      </div>
    </main>
  );
}
