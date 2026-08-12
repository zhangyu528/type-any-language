'use client';

/**
 * AppHeader — 60px 全局顶部 chrome,fixed 定位,磨砂薄荷底。
 *
 * 设计语言:统一、克制,单点金属。
 *   - 磨砂半透 + backdrop blur,底部 1px 发丝边。
 *   - 左:静态点阵品牌 mark + 文字(无像素溶解等抢戏动效)。
 *   - 中(仅 landing):三个安静文字锚点,hover 变品牌色,当前 section
 *     下划线;不做彩虹循环文字。
 *   - 右:主题切换(ghost IconButton) + 登录(ghost 文字) + 开始读
 *     (唯一主按钮,金属 SpecularButton 作为"单点金属"强调)。
 *     登录后:主题切换 + 头像圆点 + 登出(ghost 文字)。
 *
 * 之前混用的 GlareHover / GradientText / SpotlightCard 包裹已从 chrome
 * 移除,控件收拢成一套语言;金属高光只在主 CTA 出现一次。
 *
 * Route-aware:在 /login、/signup 返回 null(那些页面自带品牌卡,
 * 全局 chrome 会与卡片的"返回首页"入口打架)。
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import SpecularButton from '@/components/SpecularButton';
import { useAuth } from '../lib/auth';

/** 登录 / 注册路由:全局 chrome 在这些页面隐藏。 */
const HIDE_CHROME_PATHS = ['/login', '/signup'];

/** Landing nav 锚点 — label 与 landing 各 section H2 对齐。 */
const LANDING_ANCHORS = [
  { label: '怎么用', href: '#how-it-works' },
  { label: '场景',   href: '#scenarios' },
  { label: '词库',   href: '#lib-strip' },
];

/** 当前可见 section 的 id,用于锚点高亮。 */
function useActiveSectionIds(ids: string[]) {
  const [active, setActive] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const els = ids
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActive('#' + visible[0].target.id);
      },
      { rootMargin: '-30% 0px -50% 0px', threshold: [0, 0.25, 0.5] }
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [ids]);
  return active;
}

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const activeAnchor = useActiveSectionIds(
    LANDING_ANCHORS.map(i => i.href.slice(1))
  );

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

      {/* Landing-only:安静文字锚点。当前 section 用 data-active 下划线高亮。 */}
      {isLanding && (
        <nav className="app-header__anchors" aria-label="页面导航">
          {LANDING_ANCHORS.map(item => {
            const isActive = activeAnchor === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                data-active={isActive || undefined}
                aria-current={isActive ? 'true' : undefined}
                className="app-header__anchor"
                aria-label={
                  item.href.slice(1) === 'how-it-works'
                    ? '跳到「怎么用」section'
                    : item.href.slice(1) === 'scenarios'
                      ? '跳到「场景」section'
                      : '跳到「词库」section'
                }
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      )}

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
              onClick={() => router.push('/dashboard')}
              tint="var(--ds-action)"
              tintOpacity={0.5}
              baseColor="var(--ds-action-deep)"
              lineColor="var(--white)"
              textColor="var(--white)"
              blur={3}
              intensity={0.7}
              followMouse
              proximity={200}
              aria-label="开始读"
            >
              开始读 →
            </SpecularButton>
          </>
        )}
      </nav>
    </header>
  );
}
