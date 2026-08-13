'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import LoadingMark from '../components/LoadingMark';
import TranslationSession from '../TranslationSession';
import { useAuth } from '../lib/auth';
import Aurora from '@/components/Aurora';
import styles from './Practice.module.css';

/**
 * Standalone practice route. Dashboard chooses the library, but the drill
 * owns the full page so its layout is not constrained by dashboard cards.
 * Aurora background is added as a subtle layer behind the practice content.
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

  const returnTo = params.get('from') === 'dashboard' ? '/dashboard' : '/';

  if (authLoading || !user) return <PracticeLoading />;
  if (!libId) {
    router.replace(returnTo);
    return <PracticeLoading />;
  }

  return (
    <main className={styles.root}>
      {/* Aurora background - subtle layer behind content */}
      <Aurora className="fixed inset-0 z-0" />

      <div className={styles.content}>
        <header className={styles.masthead} aria-label="练习页头部">
          <button
            type="button"
            className={styles.mastheadBrand}
            onClick={() => router.push(returnTo)}
          >
            ← 返回
          </button>
        </header>
        <TranslationSession
          libId={libId}
          onBack={() => router.push(returnTo)}
        />
      </div>
    </main>
  );
}
