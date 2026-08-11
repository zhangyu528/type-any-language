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
import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import ThemeToggle from './ThemeToggle';

/**
 * HIDE_CHROME_PATHS — paths where the global chrome is hidden because
 * the page provides its own header (login / signup have brand links
 * inside the bubble card; AppHeader would fight with their "back to
 * home" affordance).
 *
 * /dashboard keeps the global chrome — it acts as the brand +
 * signout + theme switcher surface — and renders GreetingBar below
 * it as the dashboard's own contextual header.
 */
const HIDE_CHROME_PATHS = ['/login', '/signup'];

/**
 * 登录 / 注册按钮：直接跳转独立路由，不再用 modal。
 *
 * 原设计上 AppHeader 触发 AuthModal（in-app 弹窗），但 modal 渲染在
 * landing layout 上下文里——不带 auth 路由的 Aurora 背景、100px 留白、
 * `.auth-shell` 内联 CSS，跟直访 `/login` 视觉不一致。
 *
 * 现在 AppHeader 直接 Link 到 /login / signup 路由：
 *   - 单一登录体验（任何位置点登录都是同一个页面）
 *   - 支持 `?from=` 回跳
 *   - 浏览器后退/前进正常工作
 *
 * AuthModal 仍保留给页面内触发（TranslationSession 提示卡的 onLogin），
 * 那种场景下用户正在练习中，跳全页会丢上下文。
 */
export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // 登出后主动导航到 landing,而不是让当前受保护路由的 auth guard
  // 推进 /login?from=<current> —— 因为 /login 的 X / Escape 也会读取
  // from 推回这里,在 user=null 时这两个守卫互相反弹形成死循环。
  // (和 /me/SettingsTab 登出行为保持一致: logout 完直接去 /。)
  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/');
  }, [logout, router]);

  if (HIDE_CHROME_PATHS.some((p) => pathname === p || pathname?.startsWith(p + '/'))) {
    return null;
  }

  // Landing page uses its own Citrus Mint palette — let the header sit
  // on top of it as a transparent layer instead of the default heal-bg
  // frosted glass, otherwise the top 52px reads as a green band on the
  // otherwise near-white hero.
  const isLanding = pathname === '/';

  // 把当前路径作为回跳目标传入 /login / signup，例如 /me 守卫会带
  // `?from=/me`，登录成功后 router.replace 回 /me。
  const fromParam =
    pathname && pathname !== '/' && !HIDE_CHROME_PATHS.includes(pathname)
      ? `?from=${encodeURIComponent(pathname)}`
      : '';

  return (
    <header
      className={`app-header${isLanding ? ' app-header--landing' : ''}`}
      role="banner"
    >
      <span className="app-header__brand">
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
                void handleLogout();
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
              href={`/signup${fromParam}`}
              className="app-header__signup"
              aria-label="注册"
            >
              注册
            </Link>
            <Link
              href={`/login${fromParam}`}
              className="app-header__login"
              aria-label="登录"
            >
              登录
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}