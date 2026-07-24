'use client';

/**
 * /history — placeholder for the user's account / activity surface.
 *
 * Auth gate:
 *  - Reads `user` from useAuth(). If null (anonymous), redirect to
 *    /login with `?from=/history` so we can bounce back after login.
 *  - The redirect uses `router.replace` so the back button doesn't
 *    trap the user on the auth page.
 *
 * Why a useEffect gate rather than a server-side redirect:
 *  - The cookie is HttpOnly so a server component can't read it
 *    (Next.js 14 app dir server components don't see cookies unless
 *    you explicitly mark the route as dynamic and use `cookies()`).
 *  - The <AuthProvider> already hydrates `user` on mount — we just
 *    gate the render on that.
 *
 * Future content goes here: avatar / display name, "log out
 * everywhere", account deletion, and the eventual sentence /
 * progress history (right now progress lives in localStorage and
 * is per-device — the cloud-sync phase will populate this page).
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../lib/auth';

export default function HistoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Preserve the intended destination across the auth bounce:
      // sending ?from=<current path> lets the auth page's
      // safeRedirectPath() resolve back to /history after a
      // successful login, instead of dumping the user on `/`.
      const here = pathname || '/history';
      router.replace(`/login?from=${encodeURIComponent(here)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <div className="practice practice--loading">
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  return (
    <div className="practice">
      <div className="practice__content">
        <header className="masthead" aria-label="page header">
          <Link href="/" className="masthead__brand">
            ← 返回练习
          </Link>
        </header>

        <h1
          className="home__title"
          style={{ marginTop: 'var(--space-6)' }}
        >
          欢迎,{user.display_name}
        </h1>
        <p
          className="home__caption"
          style={{ marginTop: 'var(--space-2)' }}
        >
          这里是你的账户主页。练习历史、云同步、设置都会在这里。
        </p>
        <p
          className="home__meta"
          style={{ marginTop: 'var(--space-4)', color: 'var(--label-tertiary)' }}
        >
          注册于 {new Date(user.created_at).toLocaleDateString('zh-CN')}
        </p>
      </div>
    </div>
  );
}