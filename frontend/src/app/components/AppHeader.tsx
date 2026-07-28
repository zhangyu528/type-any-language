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
 *   - Right side: in the anonymous state, two pills "登录" (primary)
 *     + "注册" (ghost); once signed in, swaps to the avatar + 登出
 *     pair.
 *
 * Route-aware:
 *   - Renders null on /login and /signup. Those pages have their own
 *     brand link inside the aurora glass card; a global chrome on
 *     top would fight with the card's own "back to home" affordance.
 *     Keeping the chrome out of the auth flow preserves the "you're
 *     entering a private space" visual context shift.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '../lib/auth';

const HIDE_CHROME_PATHS = ['/login', '/signup'];

/** Build a same-origin `?from=<current>` query for the auth pages.
 *  Used so a successful login/signup returns the user to where they
 *  came from. */
function currentPathWithQuery(pathname: string | null, search: string | null): string {
  const path = pathname || '/';
  return search ? `${path}${search}` : path;
}

export default function AppHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading, logout } = useAuth();

  if (HIDE_CHROME_PATHS.some((p) => pathname === p || pathname?.startsWith(p + '/'))) {
    return null;
  }

  // On the public routes (/, /?lib=X, /history, etc.). Append ?from=<current>
  // so a successful login returns the user to where they clicked from.
  const here = currentPathWithQuery(pathname, searchParams?.toString() ?? null);
  const loginHref = here === '/' ? '/login' : `/login?from=${encodeURIComponent(here)}`;
  const signupHref = here === '/' ? '/signup' : `/signup?from=${encodeURIComponent(here)}`;

  return (
    <header className="app-header" role="banner">
      <Link href="/" className="app-header__brand" aria-label="返回首页">
        <span className="app-header__brand-mark" aria-hidden="true">◯</span>
        <span className="app-header__brand-name">Type Any Language</span>
      </Link>

      <nav className="app-header__nav" aria-label="主导航">
        {loading ? null : user ? (
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
          <>
            <Link
              href={signupHref}
              className="app-header__signup"
              aria-label="注册"
            >
              注册
            </Link>
            <Link href={loginHref} className="app-header__login" aria-label="登录">
              登录
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}