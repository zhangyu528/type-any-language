'use client';

/**
 * /me — redirect into the learning console.
 *
 * As of the dashboard-console refactor, the "个人中心" surface (stats /
 * collection / settings) lives at /dashboard with section navigation.
 * /me now collapses to a thin redirect:
 *   - anonymous → /login?from=/dashboard/settings (auth gate parity)
 *   - signed-in  → /dashboard/settings
 *
 * The AccountCard (display name / email / joined) was migrated into the
 * dashboard overview + settings; the standalone /me page is retired to
 * keep a single source of truth for account UI.
 */

import { Suspense, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth';

function MeInner() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const here = pathname || '/dashboard/settings';
      router.replace(`/login?from=${encodeURIComponent(here)}`);
      return;
    }
    router.replace('/dashboard/settings');
  }, [loading, user, router, pathname]);

  return (
    <div className="practice practice--loading">
      <p className="practice__loader-text">正在跳转…</p>
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense
      fallback={
        <div className="practice practice--loading">
          <p className="practice__loader-text">Loading…</p>
        </div>
      }
    >
      <MeInner />
    </Suspense>
  );
}
