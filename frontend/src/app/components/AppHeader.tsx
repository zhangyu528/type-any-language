'use client';

/**
 * AppHeader — landing-only 顶部 chrome,磨砂 pill
 *
 * 设计语言:统一、克制,单点金属。
 *   - 磨砂半透 + backdrop blur,底部 1px 发丝边。
 *   - 左:静态点阵品牌 mark + 文字(无像素溶解等抢戏动效)。
 *   - 右:登录(ghost 文字,触发 AuthModal —— 0 navigation,modal 在当前页盖出)
 *     + 开始读
 *     (唯一主按钮,金属 SpecularButton 作为"单点金属"强调)。
 *     登录后:头像圆点 + 登出(ghost 文字)。
 *     (主题切换从 nav 移到 /me/settings 偏好项 —— 2026-08 简化 nav)
 *   - 2026-08:登录 / 注册按钮改用 useAuthModal().open()(不再 router.push),
 *     modal 直接在当前页盖出;from 作为 state.from 传给 modal,modal 成功后跳回。
 *   - 中间不再放锚点(2026-08 优化):"怎么用 / 场景 / 词库"三个锚点
 *     删除 —— 场景对应的 section 已下线,#scenarios 锚点会 404;
 *     词库跳转价值低(LibStrip 卡直接可点);"怎么用"被同质化成"页内
 *     in-page 滚动"也属于冗余中间层。header 现在是品牌 + 主 CTA 双点
 *     结构,跟 Stripe / Linear / Vercel 一致。
 *
 * 之前混用的 GlareHover / GradientText / SpotlightCard 包裹已从 chrome
 * 移除,控件收拢成一套语言;金属高光只在主 CTA 出现一次。
 *
 * Route-aware:不再 hide /login / /signup(stub 页面,见对应 page.tsx 注释),
 * 全局 chrome 始终显示。
 *
 * 2026-08 polish (landing-perf sweep):
 *   - CSS 移到 AppHeader.module.css (跟 landing 各 section 一致)
 *   - 滚出 hero 区 header 渐隐,向上滚再显(scroll-driven,提升阅读沉浸感)
 *   - 登出加 confirm(防误点)
 *   - 加 skip link (WCAG 2.4.1,键盘 / 屏幕阅读器用户 Tab 一次跳到 hero)
 *   - nav 加主题切换 icon (sun/moon,landing 用户能立即切,不用去 /me/settings)
 *   - 主 CTA 文案 "注册 →" → "免费开始"(漏斗最顶更直接)
 *   - isolation: isolate 独立 stacking context (header / modal 不混 z-index)
 *   - header 入场 delay 200ms (让 hero 先出现,层次更清晰)
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import LazySpecularButton from '@/components/LazySpecularButton';
import { usePathname, useRouter } from 'next/navigation';
import { Sun, Moon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useAuthModal } from '../lib/authModal';
import { useTheme } from './ThemeProvider';
import styles from './AppHeader.module.css';

/* The header CTA (注册) wraps an `ogl` WebGL shader. Lazy-load it via
   LazySpecularButton so `ogl` stays out of the landing's first-paint
   chunk. The placeholder reuses the login button's class to hold the same
   box, then fades into the shiny CTA once it mounts. */

/* 滚出 隐藏 阈值 (px):用户向下滚动超过这个距离,header 渐隐。
   60px = 滚过 hero 区一小段就藏,灵敏 (之前 120px 滚 2 屏才藏,阅读时被 nav 干扰)。 */
const SCROLL_HIDE_THRESHOLD = 60;
/* 向上滚 阈值 (px):用户向上滚动超过这个距离,header 渐显。
   设得小一些,让向上滚一点点就能恢复 nav,符合"我要回去看 nav"的心智。 */
const SCROLL_SHOW_THRESHOLD = 30;
/* 滚到顶立即显示:不管 scroll 状态,只要 y < SCROLL_TOP_THRESHOLD 立即显 nav,
   避免"想点 nav 但 header 藏"的用户体验断点。 */
const SCROLL_TOP_THRESHOLD = 60;
/* 移动端 hamburger 折叠阈值:viewport < 720px 时 nav 折成 hamburger */
const HAMBURGER_BREAKPOINT = 720;

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { open: openAuthModal } = useAuthModal();
  const { theme, toggleTheme } = useTheme();

  // scroll-driven hide/show:用累加 delta (touchpad / 惯性滚动友好)。
  // 之前单帧 delta > 60 在 touchpad 慢滚时永远累不到 60,只有 mouse wheel
  // 一格 100px 才触发 — 这就是为什么滚到 section2 才看到隐藏。
  // 改:每帧 delta 累加,达到阈值触发,触发后清零,下次重新累加。
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastY = window.scrollY;
    let accDelta = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // 滚到顶立即显 nav,避免"想点 nav 但 header 藏"。
        if (y < SCROLL_TOP_THRESHOLD) {
          setHidden(false);
          accDelta = 0;
          lastY = y;
          ticking = false;
          return;
        }
        const delta = y - lastY;
        accDelta += delta;
        if (accDelta > SCROLL_HIDE_THRESHOLD) {
          setHidden(true);
          accDelta = 0;
        } else if (accDelta < -SCROLL_SHOW_THRESHOLD) {
          setHidden(false);
          accDelta = 0;
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 移动端 hamburger 折叠:viewport < 720px 时把 nav 折成菜单按钮。
  // 检测方式:matchMedia 监听 (resize 时也触发) — 比 useEffect + resize
  // listener 简洁,自动跟随系统 / 浏览器宽度变化。
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${HAMBURGER_BREAKPOINT - 1}px)`);
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  // 路由切换 / 路由守卫(切到非 /)时关闭 menu
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // 登出加 confirm:防误点(之前直接跳 /,点错就退出)。
  // 必须在所有 early return 之前(避免 hook 顺序变化)。
  const handleLogout = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('确定要登出吗?')) return;
    await logout();
    router.push('/');
  }, [logout, router]);

  // AppHeader is the LANDING PAGE's own chrome only — it is no longer a
  // global top bar. It is rendered solely by app/page.tsx on the landing
  // home view (`/`), and never on the practice session, dashboard, me, or
  // any other route. The guard below is defensive: if it ever gets mounted
  // outside the landing home view, hide it so it can't leak a redundant nav
  // onto a focused surface (which would also eat the ~52-60px of vertical
  // space the "fit on one screen, no scroll" polish reclaims).
  if (pathname !== '/') {
    return null;
  }

  const isLanding = pathname === '/';

  // 当前路径作为回跳目标传给 modal.open({from})。modal 成功后跳回。
  // 首页('/')不传 —— 登录后默认落 /dashboard(在 AuthModal 里 hardcode)。
  const fromParam =
    pathname && pathname !== '/'
      ? encodeURIComponent(pathname)
      : undefined;

  const rootClass = [
    styles.root,
    isLanding ? styles['root--landing'] : '',
    hidden ? styles['root--hidden'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <header className={rootClass} role="banner">
      {/* WCAG 2.4.1 Bypass Blocks:键盘 / 屏幕阅读器用户 Tab 一次就能跳过
         整个 nav 直接进 hero,不用 Tab 5+ 次过 brand / login / register。 */}
      <a href="#hero" className={styles.skipLink}>
        跳到主内容
      </a>

      <Link href="/" className={styles.brand} aria-label="Type Any Language · 首页">
        <svg
          className={styles.brandMark}
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
        <span className={styles.brandName}>Type Any Language</span>
      </Link>

      {isMobile ? (
        /* 移动端:nav 折成 hamburger 按钮 + slide-down menu。
           menu 自身 absolute 定位在 header 下方,不挤占 header 高度。 */
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.hamburger}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
          >
            <span className={`${styles.hamburgerBar} ${menuOpen ? styles.hamburgerBarOpen : ''}`} />
            <span className={`${styles.hamburgerBar} ${menuOpen ? styles.hamburgerBarOpen : ''}`} />
            <span className={`${styles.hamburgerBar} ${menuOpen ? styles.hamburgerBarOpen : ''}`} />
          </button>
          <div
            id="landing-mobile-menu"
            className={`${styles.menu} ${menuOpen ? styles.menuOpen : ''}`}
            role="menu"
            aria-hidden={!menuOpen}
          >
            {loading ? null : user ? (
              <>
                <Link
                  href="/dashboard/settings"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  我的主页
                </Link>
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleLogout();
                  }}
                >
                  登出
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    openAuthModal('login', { from: fromParam });
                  }}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={toggleTheme}
                >
                  {theme === 'light' ? '深色主题' : '浅色主题'}
                </button>
                <button
                  type="button"
                  className={styles.menuItemPrimary}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    openAuthModal('signup', { from: fromParam });
                  }}
                >
                  免费开始
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
      <nav className={styles.nav} aria-label="主导航">
        {loading ? null : user ? (
          <>
            <Link
              href="/dashboard/settings"
              className={styles.avatar}
              aria-label={`${user.display_name} — 我的主页`}
              title={`${user.display_name} · 我的主页`}
            >
              {user.display_name.charAt(0).toUpperCase()}
            </Link>
            <button
              type="button"
              className={styles.logoutBtn}
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
              className={styles.loginBtn}
              onClick={() => openAuthModal('login', { from: fromParam })}
              aria-label="登录"
            >
              登录
            </button>
            {/* 主题切换:landing 用户能立即切,不用去 /me/settings。
                sun/moon icon (lucide-react),无障碍 label 跟图标语义对齐。 */}
            <button
              type="button"
              className={styles.themeToggle}
              onClick={toggleTheme}
              aria-label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
              title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <LazySpecularButton
              placeholder={
                <button type="button" className={styles.loginBtn} aria-hidden="true" tabIndex={-1}>
                  免费开始
                </button>
              }
              size="sm"
              /* 主 CTA "注册":匿名访客看到的是转化漏斗最顶(创建账户)。
                 文案 "免费开始" 比 "注册 →" 更直接 —— 漏斗最顶用户没建立
                 "我要注册" 的意图,直接告诉"免费、开始"降低决策成本。
                 颜色走品牌蓝(--ds-action / --ds-action-deep);注册提交
                 弹窗的「继续」按钮(CurvedInput)同样走品牌蓝,保持一致。
                 带 fromParam 让注册完成后回到用户原来想去的页面。 */
              onClick={() => openAuthModal('signup', { from: fromParam })}
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
              免费开始
            </LazySpecularButton>
          </>
        )}
      </nav>
      )}
    </header>
  );
}