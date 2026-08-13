'use client';

/**
 * AppHeader — 全局顶部 chrome,fixed 定位,磨砂薄荷底。
 *
 * 设计语言:统一、克制,单点金属。
 *   - 磨砂半透 + backdrop blur,底部 1px 发丝边。
 *   - 左:静态点阵品牌 mark + 文字(无像素溶解等抢戏动效)。
 *   - 右:主题切换(ghost IconButton) + 登录(ghost 文字) + 开始读
 *     (唯一主按钮,金属 SpecularButton 作为"单点金属"强调)。
 *     登录后:主题切换 + 头像圆点 + 登出(ghost 文字)。
 *   - 中间不再放锚点(2026-08 优化):"怎么用 / 场景 / 词库"三个锚点
 *     删除 —— 场景对应的 section 已下线,#scenarios 锚点会 404;
 *     词库跳转价值低(LibStrip 卡直接可点);"怎么用"被同质化成"页内
 *     in-page 滚动"也属于冗余中间层。header 现在是品牌 + 主 CTA 双点
 *     结构,跟 Stripe / Linear / Vercel 一致。
 *
 * 之前混用的 GlareHover / GradientText / SpotlightCard 包裹已从 chrome
 * 移除,控件收拢成一套语言;金属高光只在主 CTA 出现一次。
 *
 * Route-aware:在 /login、/signup 返回 null(那些页面自带品牌卡,
 * 全局 chrome 会与卡片的"返回首页"入口打架)。
 */
import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import SpecularButton from '@/components/SpecularButton';
import { useAuth } from '../lib/auth';

/** 登录 / 注册路由:全局 chrome 在这些页面隐藏。 */
const HIDE_CHROME_PATHS = ['/login', '/signup'];

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // 登出后主动去 landing,避免 /me 守卫把 user=null 推回 /login 形成死循环。
  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/');
  }, [logout, router]);

  if (HIDE_CHROME_PATHS.some((p) => pathname === p || pathname?.startsWith(p + '/'))) {
    return null;
  }

  const isLanding = pathname === '/';

  // 当前路径作为回跳目标传入 /login / signup。
  const fromParam =
    pathname && pathname !== '/' && !HIDE_CHROME_PATHS.includes(pathname)
      ? `?from=${encodeURIComponent(pathname)}`
      : '';

  return (
    <header
      className={`app-header${isLanding ? ' app-header--landing' : ''}`}
      role="banner"
    >
      <Link href="/" className="app-header__brand" aria-label="Type Any Language · 首页">
        <svg
          className="app-header__brand-mark"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--ds-action-deep)" />
          <g fill="#fff">
            {[8, 12, 16].flatMap(cy =>
              [8, 12, 16].map(cx => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />
              ))
            )}
          </g>
        </svg>
        <span className="app-header__brand-name">Type Any Language</span>
      </Link>

      <nav className="app-header__nav" aria-label="主导航">
        <ThemeToggle />
        {loading ? null : user ? (
          <>
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
              className="app-header__logoutBtn"
              onClick={() => void handleLogout()}
              aria-label="登出"
            >
              登出
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="app-header__loginBtn"
              onClick={() => router.push(`/login${fromParam}`)}
              aria-label="登录"
            >
              登录
            </button>
            <SpecularButton
              size="sm"
              /* 主 CTA 改 "注册":匿名访客看到的是转化漏斗最顶(创建账户),
                 而不是直接进 dashboard。带 fromParam 让注册完成后回到
                 用户原来想去的页面(/dashboard 或 ?lib=X 之类)。 */
              onClick={() => router.push(`/signup${fromParam}`)}
              tint="var(--ds-action)"
              tintOpacity={0.5}
              baseColor="var(--ds-action-deep)"
              lineColor="var(--white)"
              textColor="var(--white)"
              blur={3}
              intensity={0.7}
              followMouse
              proximity={200}
              aria-label="注册"
            >
              注册 →
            </SpecularButton>
          </>
        )}
      </nav>
    </header>
  );
}