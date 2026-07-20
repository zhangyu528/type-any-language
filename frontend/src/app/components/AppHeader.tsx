'use client';

/**
 * AppHeader — 36px frosted glass top chrome, fixed-position.
 *
 * Why a top chrome: master has no global nav today (Home is the landing
 * page, TranslationStage is the only destination). The auth surface
 * (/login, /signup) is the first piece that needs a way in. A short,
 * fixed-position chrome:
 *   - doesn't push the practice layout (position: fixed, content keeps
 *     its own padding-top)
 *   - matches modern SaaS convention (Linear / Notion / Vercel)
 *   - gives us a future home for tabs, avatar menu, settings, etc.
 *
 * Visual:
 *   - 36px tall, full-width, z-index 50 (above content, below modals)
 *   - Frosted: rgba(255,255,255,0.78) + backdrop blur(20px) — the
 *     page bg bleeds through subtly, matching the macOS Big Sur
 *     nav-bar feel
 *   - Hairline border-bottom (1px rgba(0,0,0,0.06)) for the
 *     "elevated above content" cue
 *   - Brand mark on the left (enso ◯ + name) — clickable, returns
 *     to `/`
 *   - Login pill on the right — same gradient as auth pages' submit
 *     button (visual consistency: one "primary action" look across
 *     the app)
 *
 * Route-aware:
 *   - Renders null on /login and /signup. Those pages have their own
 *     brand link inside the aurora glass card; a global chrome on
 *     top would fight with the card's own "back to home" affordance.
 *     Keeping the chrome out of the auth flow preserves the "you're
 *     entering a private space" visual context shift.
 *
 * The chrome is intentionally NOT auth-aware (no avatar / logout /
 * dropdown yet). When the auth backend lands, swap the right side
 * conditionally based on useAuth().
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth';

const HIDE_CHROME_PATHS = ['/login', '/signup'];

export default function AppHeader() {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  if (HIDE_CHROME_PATHS.some((p) => pathname === p || pathname?.startsWith(p + '/'))) {
    return null;
  }

  // While the initial /api/auth/me is in flight, render a chrome
  // shell with the login pill in place — the moment /me resolves,
  // we either keep the pill (anonymous) or swap to avatar+logout
  // (signed in). The swap is a React state update; the layout
  // doesn't shift because both pills share the same 28px height.
  // We intentionally don't show a spinner here — the chrome is a
  // chrome, not a status indicator.

  return (
    <header className="app-header" role="banner">
      <Link href="/" className="app-header__brand" aria-label="返回首页">
        <span className="app-header__brand-mark" aria-hidden="true">◯</span>
        <span className="app-header__brand-name">Type Any Language</span>
      </Link>

      <nav className="app-header__nav" aria-label="主导航">
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
    </header>
  );
}
