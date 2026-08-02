'use client';

/**
 * AppHeader — 52px 全局顶部 chrome,fixed-position(TAL Mint)。
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
 * Visual(TAL Mint,样式唯一出处 = globals.css .app-header*):
 *   - 薄荷底半透 + backdrop blur,底部 1px --ds-border
 *   - 左:BrandMark 3×3 点阵 + 名称
 *   - 右:匿名时 "登录"(薄荷填充 pill)+ "注册"(ghost pill);
 *     登录后换为头像 + 登出
 *
 * Route-aware:
 *   - Renders null on /login and /signup. Those pages have their own
 *     brand link inside the bubble card; a global chrome on
 *     top would fight with the card's own "back to home" affordance.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '../lib/auth';
import BrandMark from '../landing/BrandMark';
import ThemeToggle from './ThemeToggle';

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

  // On the public routes (/, /?lib=X, etc.). Append ?from=<current>
  // so a successful login returns the user to where they clicked from.
  const here = currentPathWithQuery(pathname, searchParams?.toString() ?? null);
  const loginHref = here === '/' ? '/login' : `/login?from=${encodeURIComponent(here)}`;
  const signupHref = here === '/' ? '/signup' : `/signup?from=${encodeURIComponent(here)}`;

  // Landing page uses its own Citrus Mint palette — let the header sit
  // on top of it as a transparent layer instead of the default heal-bg
  // frosted glass, otherwise the top 52px reads as a green band on the
  // otherwise near-white hero.
  const isLanding = pathname === '/';

  return (
    <header
      className={`app-header${isLanding ? ' app-header--landing' : ''}`}
      role="banner"
    >
      <span className="app-header__brand">
        <span className="app-header__brand-mark" aria-hidden="true">
          <BrandMark size={20} />
        </span>
        <span className="app-header__brand-name">Type Any Language</span>
      </span>

      <nav className="app-header__nav" aria-label="主导航">
        {loading ? (
          <ThemeToggle />
        ) : user ? (
          <>
            <ThemeToggle />
            <Link
              href="/me"
              className="app-header__avatar"
              aria-label={`${user.display_name} — 我的主页`}
              title={`${user.display_name} · 我的主页`}
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
            <ThemeToggle />
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