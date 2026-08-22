'use client';

/**
 * DashboardNav — 固定左侧 248px 玻璃侧栏 for the learning console.
 *
 * 6 个分区扁平渲染（NAV_ITEMS,见下）。item 少,不做分组;
 * 折叠 rail 也已取消 — 单一展开态,简单清晰。等 item 扩到 8+ 或
 * 用户要求更紧凑视图时再考虑分组 / 折叠。
 *
 * URL `?section=` 是单一真相源(可深链 + 浏览器前进/后退),与 /me
 * 的 `?tab=` 同构。本组件是展示层:从 page.tsx 接收当前 `section` 与
 * `onSelect`,history.pushState 的接线由 page.tsx 负责。
 *
 * 移动端是 off-canvas 抽屉(由 `mobileOpen` / `onCloseMobile` 控制),
 * 桌面始终展开。
 *
 * 键盘:↑↓ / Home / End 在分区间移动焦点(roving tabindex,整组只占
 * 一个 Tab 位);Alt+1..6 直达对应分区;Esc 关闭账号名片,移动端抽屉
 * 打开时 Esc 关抽屉且 Tab 焦点锁在抽屉内。
 */

import Link from 'next/link';
import {
  BarChart3,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Settings,
  Trophy,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import styles from './DashboardNav.module.css';
import { useCallback, useEffect, useRef, useState } from 'react';

export type DashboardSection =
  | 'overview'
  | 'practice'
  | 'data'
  | 'achievements'
  | 'review'
  | 'settings';

interface NavItem {
  section: DashboardSection;
}

/** 扁平顺序,供 URL 校验、键盘上下移动与 Alt+N 共用。 */
export const DASHBOARD_SECTIONS: DashboardSection[] = [
  'overview',
  'practice',
  'review',
  'data',
  'achievements',
  'settings',
];

/**
 * 渲染顺序(扁平)。item 少,不做分组;等 item 扩到 8+ 或用户要求更
 * 紧凑视图时再考虑折叠 rail。
 */
const NAV_ITEMS: NavItem[] = DASHBOARD_SECTIONS.map((s) => ({ section: s }));

export const DASHBOARD_SECTION_LABEL: Record<DashboardSection, string> = {
  overview: '主页',
  practice: '发现',
  data: '数据',
  achievements: '等级和成就',
  review: '复习',
  settings: '设置',
};

const ICONS: Record<DashboardSection, LucideIcon> = {
  overview: LayoutDashboard,
  practice: GraduationCap,
  data: BarChart3,
  achievements: Trophy,
  review: RefreshCw,
  settings: Settings,
};

export interface DashboardUserLite {
  display_name: string;
  avatar_url?: string | null;
}

interface DashboardNavProps {
  section: DashboardSection;
  onSelect: (section: DashboardSection) => void;
  /** 待复习句数（snapshot.review_due_count）→ 复习项的 badge。 */
  reviewDue?: number;
  /** Signed-in user, for the footer profile chip. */
  user?: DashboardUserLite;
  /** 退出登录；不传则名片不显示登出项。 */
  onLogout?: () => void;
  /** Mobile off-canvas drawer open state. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

// package.json 的 version 由 next.config.js 注入，避免手工同步漂移。
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

export default function DashboardNav({
  section,
  onSelect,
  reviewDue = 0,
  user,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: DashboardNavProps) {
  const initial = (user?.display_name || '?').trim().charAt(0).toUpperCase();

  // 点击头像展开迷你名片（账号菜单）；点击名片外部或按 Esc 关闭。
  const [cardOpen, setCardOpen] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Partial<Record<DashboardSection, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!cardOpen) return;
    const onDown = (e: MouseEvent) => {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) {
        setCardOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCardOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [cardOpen]);

  // ---- Alt+1..6 直达分区（不与浏览器快捷键冲突：只认纯 Alt 组合） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > DASHBOARD_SECTIONS.length) return;
      e.preventDefault();
      onSelect(DASHBOARD_SECTIONS[n - 1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSelect]);

  // ---- 移动端抽屉：Esc 关闭 + Tab 焦点锁在抽屉内 ----
  useEffect(() => {
    if (!mobileOpen) return;
    // 打开时把焦点送进抽屉（关闭按钮），避免焦点留在背后的内容区。
    asideRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseMobile();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = asideRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((el) => el.tabIndex !== -1 && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);

  // ---- roving tabindex：↑↓ / Home / End 在分区间移动焦点 ----
  const focusAt = useCallback((idx: number) => {
    const list = DASHBOARD_SECTIONS;
    const target = list[((idx % list.length) + list.length) % list.length];
    itemRefs.current[target]?.focus();
  }, []);

  const onNavKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const list = DASHBOARD_SECTIONS;
      const focusedIdx = list.findIndex((s) => itemRefs.current[s] === document.activeElement);
      const from = focusedIdx >= 0 ? focusedIdx : list.indexOf(section);
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusAt(from + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusAt(from - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusAt(0);
          break;
        case 'End':
          e.preventDefault();
          focusAt(list.length - 1);
          break;
        default:
          break;
      }
    },
    [focusAt, section],
  );

  const renderItem = (s: DashboardSection) => {
    const active = s === section;
    const Icon = ICONS[s];
    const label = DASHBOARD_SECTION_LABEL[s];
    // 目前只有复习有待办数；其余分区无 badge。
    const count = s === 'review' ? reviewDue : 0;
    return (
      <button
        key={s}
        ref={(el) => {
          itemRefs.current[s] = el;
        }}
        type="button"
        className={styles.item}
        data-active={active ? 'true' : 'false'}
        onClick={() => onSelect(s)}
        aria-current={active ? 'page' : undefined}
        aria-label={count > 0 ? `${label}（${count} 句待复习）` : label}
        tabIndex={active ? 0 : -1}
      >
        <span className={styles.itemIcon} aria-hidden>
          <Icon size={20} />
        </span>
        <span className={styles.itemLabel}>{label}</span>
        {count > 0 ? (
          <span className={styles.badge} aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <aside
      ref={asideRef}
      className={styles.sidebar}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      aria-label="学习控制台导航"
    >
      <div className={styles.brand}>
        <button
          type="button"
          className={styles.brandBtn}
          onClick={() => onSelect('overview')}
          aria-label="Type Any Language · 回到主页"
        >
          <span className={styles.brandMark} aria-hidden>
            <svg viewBox="0 0 24 24" width="100%" height="100%">
              <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--ds-action-deep)" />
              <g fill="#fff">
                {[8, 12, 16].flatMap((cy) =>
                  [8, 12, 16].map((cx) => (
                    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />
                  )),
                )}
              </g>
            </svg>
          </span>
          <span className={styles.brandName}>Type Any Language</span>
        </button>
        <button
          type="button"
          className={styles.closeMobile}
          onClick={onCloseMobile}
          aria-label="关闭菜单"
          data-autofocus
        >
          <X size={18} />
        </button>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <nav className={styles.nav} aria-label="分区导航" onKeyDown={onNavKeyDown}>
        {NAV_ITEMS.map(({ section }) => (
          <div key={section} className={styles.group}>
            {renderItem(section)}
          </div>
        ))}
      </nav>

      <div className={styles.footer} ref={footerRef}>
        {/* 头像按钮：折叠 / 展开态都显示；点击展开迷你名片（账号菜单）。 */}
        <button
          type="button"
          className={styles.profile}
          onClick={() => setCardOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={cardOpen}
          aria-label={`${user?.display_name ?? '账号'} · 账号菜单`}
        >
          <span className={styles.avatar} aria-hidden>
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" />
            ) : (
              initial
            )}
          </span>
          <span className={styles.profileName}>{user?.display_name}</span>
        </button>
        {/* 点击头像展开迷你名片：个人主页 / 退出登录 / 版本号。
           「设置」不再放这里 —— 侧边栏已有独立分区，重复入口无意义。 */}
        <div
          className={styles.profileCard}
          role="menu"
          data-open={cardOpen ? 'true' : 'false'}
        >
          <span className={styles.cardAvatar} aria-hidden>
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" />
            ) : (
              initial
            )}
          </span>
          <span className={styles.cardName}>{user?.display_name}</span>
          <Link
            href="/me"
            className={styles.cardItem}
            role="menuitem"
            onClick={() => setCardOpen(false)}
          >
            <User size={14} aria-hidden />
            个人主页
          </Link>
          {onLogout ? (
            <button
              type="button"
              className={styles.cardItem}
              data-danger="true"
              onClick={() => {
                setCardOpen(false);
                onLogout();
              }}
              role="menuitem"
            >
              <LogOut size={14} aria-hidden />
              退出登录
            </button>
          ) : null}
          <span className={styles.cardVersion}>v{APP_VERSION}</span>
        </div>
      </div>
    </aside>
  );
}
