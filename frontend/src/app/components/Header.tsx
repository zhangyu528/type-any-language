'use client';

/**
 * Top bar — minimal logo + single auth affordance.
 *
 * Design intent: the app is centered on a single PracticePage (the user
 * spends 90%+ of their time there). The Header exists for two things:
 *   1. Brand identity on the left (logo + wordmark, links home).
 *   2. Single auth affordance on the right (login link for anon, avatar
 *      for signed-in). Anything more (register, history, logout) is one
 *      click deeper — kept out of the always-visible top bar.
 *
 * Hidden on /login and /signup — those pages render their own immersive
 * chrome (aurora + glass card) and use the enso brand mark as a home
 * affordance instead.
 *
 * The logo + wordmark mirrors the brand identity in the (auth) layout's
 * back-to-home link, so the brand presentation is consistent across the
 * whole app: small mark + name = "Type Any Language".
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth';

export function Header() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  // Suppress on auth route group — those pages render their own
  // immersive layout.
  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/signup')
  ) {
    return null;
  }

  if (loading) return null;

  return (
    <header className="app-header">
      <Link href="/" className="app-header__brand" aria-label="返回首页">
        <span className="app-header__brand-mark" aria-hidden="true">◯</span>
        <span className="app-header__brand-name">Type Any Language</span>
      </Link>

      <nav className="app-header__nav">
        {user ? (
          <>
            <Link
              href="/history"
              className="app-header__avatar"
              aria-label={`${user.display_name} — 我的历史`}
              title={`${user.display_name} · 我的历史`}
            >
              {user.display_name.charAt(0).toUpperCase()}
            </Link>
            <button
              type="button"
              className="app-header__logout"
              onClick={() => {
                void logout();
              }}
              aria-label="登出"
            >
              登出
            </button>
          </>
        ) : (
          <Link href="/login" className="app-header__login" aria-label="登录">
            登录
          </Link>
        )}
      </nav>

      <style jsx>{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: var(--space-3) var(--space-5);
          background: var(--surface);
          border-bottom: 1px solid var(--separator);
        }
        .app-header__brand {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          text-decoration: none;
          color: var(--label-primary);
          padding: var(--space-1) var(--space-2);
          margin: calc(var(--space-1) * -1) calc(var(--space-2) * -1);
          border-radius: var(--radius-sm);
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .app-header__brand:hover {
          background: var(--surface-secondary);
        }
        .app-header__brand-mark {
          font-size: 18px;
          color: var(--accent);
          line-height: 1;
        }
        .app-header__brand-name {
          font-size: var(--type-body-emphasis);
          font-weight: var(--type-title-3-weight);
          letter-spacing: -0.01em;
        }
        .app-header__nav {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }
        .app-header__login {
          display: inline-flex;
          align-items: center;
          height: 32px;
          padding: 0 var(--space-4);
          font-size: var(--type-body);
          font-weight: var(--type-body-emphasis-weight);
          color: var(--surface);
          background: var(--label-primary);
          border-radius: var(--radius-circle);
          text-decoration: none;
          transition: opacity var(--duration-fast) var(--ease-standard),
                      transform var(--duration-fast) var(--ease-standard);
        }
        .app-header__login:hover {
          opacity: 0.85;
          transform: translateY(-1px);
        }
        .app-header__avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-circle);
          background: var(--accent);
          color: var(--surface);
          font-size: var(--type-body-emphasis);
          font-weight: var(--type-title-3-weight);
          text-decoration: none;
          transition: opacity var(--duration-fast) var(--ease-standard),
                      transform var(--duration-fast) var(--ease-standard);
        }
        .app-header__avatar:hover {
          opacity: 0.85;
          transform: translateY(-1px);
        }
        .app-header__logout {
          background: transparent;
          border: 0;
          padding: 0 var(--space-2);
          height: 32px;
          cursor: pointer;
          color: var(--label-tertiary);
          font-size: var(--type-caption);
          font-family: inherit;
          border-radius: var(--radius-sm);
          transition: color var(--duration-fast) var(--ease-standard),
                      background var(--duration-fast) var(--ease-standard);
        }
        .app-header__logout:hover {
          color: var(--label-primary);
          background: var(--surface-secondary);
        }
      `}</style>
    </header>
  );
}