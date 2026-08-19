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
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import SpecularButton from '@/components/SpecularButton';
import { useAuth } from '../lib/auth';
import { useAuthModal } from '../lib/authModal';
import styles from './AppHeader.module.css';

/* 滚出 隐藏 阈值 (px):用户向下滚动超过这个距离,header 渐隐 */
const SCROLL_HIDE_THRESHOLD = 120;
/* 向上滚 阈值 (px):用户向上滚动超过这个距离,header 渐显。
   设得小一些,让向上滚一点点就能恢复 nav,符合"我要回去看 nav"的心智。 */
const SCROLL_SHOW_THRESHOLD = 40;

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { open: openAuthModal } = useAuthModal();

  // scroll-driven hide/show:用 lastY + lastDir 跟踪滚动方向。
  // 向下滚过阈值 → hide,向上滚过阈值 → show,避免抖动。
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (delta > SCROLL_HIDE_THRESHOLD && y > 240) {
          setHidden(true);
        } else if (delta < -SCROLL_SHOW_THRESHOLD) {
          setHidden(false);
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
            <SpecularButton
              size="sm"
              /* 主 CTA "注册":匿名访客看到的是转化漏斗最顶(创建账户)。
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
              注册 →
            </SpecularButton>
          </>
        )}
      </nav>
    </header>
  );
}