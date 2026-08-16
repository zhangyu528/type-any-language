'use client';

/**
 * DashboardNav — fixed left sidebar for the learning console.
 *
 * Five sections (主页 / 课程 / 数据 / 收藏 / 设置). The URL `?section=`
 * is the single source of truth (deep-linkable + browser back/forward),
 * matching /me's `?tab=` pattern. This component is presentational: it
 * receives the active `section` and an `onSelect` handler from page.tsx,
 * which owns the history.pushState wiring.
 *
 * Layout: a 248px glass sidebar that can collapse to a 76px icon rail
 * (desktop) and becomes an off-canvas drawer on mobile (controlled via
 * the `mobileOpen` / `onCloseMobile` props).
 */

import {
  BarChart3,
  Bookmark,
  ChevronsLeft,
  ChevronsRight,
  GraduationCap,
  LayoutDashboard,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import styles from './DashboardNav.module.css';
import { useEffect, useRef, useState } from 'react';

export type DashboardSection =
  | 'overview'
  | 'practice'
  | 'data'
  | 'collection'
  | 'settings';

export const DASHBOARD_SECTIONS: DashboardSection[] = [
  'overview',
  'practice',
  'data',
  'collection',
  'settings',
];

export const DASHBOARD_SECTION_LABEL: Record<DashboardSection, string> = {
  overview: '主页',
  practice: '课程',
  data: '数据',
  collection: '收藏',
  settings: '设置',
};

const ICONS: Record<DashboardSection, LucideIcon> = {
  overview: LayoutDashboard,
  practice: GraduationCap,
  data: BarChart3,
  collection: Bookmark,
  settings: Settings,
};

export interface DashboardUserLite {
  display_name: string;
  avatar_url?: string | null;
}

interface DashboardNavProps {
  section: DashboardSection;
  onSelect: (section: DashboardSection) => void;
  /** Live count for the 收藏 badge (sentences in the collection). */
  collectionCount?: number;
  /** Signed-in user, for the footer profile chip. */
  user?: DashboardUserLite;
  /** Desktop effective collapse-to-rail state (collapsed unless pinned). */
  collapsed: boolean;
  /** When true the rail is locked open (pinned). */
  pinned: boolean;
  /** Toggle the pinned (locked-open) state. */
  onTogglePin: () => void;
  /** Mobile off-canvas drawer open state. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export default function DashboardNav({
  section,
  onSelect,
  collectionCount = 0,
  user,
  collapsed,
  pinned,
  onTogglePin,
  mobileOpen,
  onCloseMobile,
}: DashboardNavProps) {
  const initial = (user?.display_name || '?').trim().charAt(0).toUpperCase();

  // 点击头像展开迷你名片（账号菜单）；点击名片外部或按 Esc 关闭。
  const [cardOpen, setCardOpen] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
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

  // 与 frontend/package.json 的 version 保持一致。
  const APP_VERSION = '0.1.0';

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      aria-label="学习控制台导航"
    >
      {/* 伸缩(pin)控件：悬浮在侧边栏右边缘中部的「标签」按钮，
         桌面 / 折叠 rail 通用，不占 header/footer 空间，也不挡导航。 */}
      <button
        type="button"
        className={styles.pinBtn}
        onClick={onTogglePin}
        aria-pressed={pinned}
        aria-label={pinned ? '收起侧边栏' : '展开侧边栏'}
        title={pinned ? '收起侧边栏' : '展开侧边栏'}
      >
        {pinned ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
      </button>

      <div className={styles.brand}>
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
        <button
          type="button"
          className={styles.closeMobile}
          onClick={onCloseMobile}
          aria-label="关闭菜单"
        >
          <X size={18} />
        </button>
      </div>
      <span className={styles.version}>v{APP_VERSION}</span>

      <nav className={styles.nav} aria-label="分区导航">
        {DASHBOARD_SECTIONS.map((s) => {
          const active = s === section;
          const Icon = ICONS[s];
          return (
            <button
              key={s}
              type="button"
              className={styles.item}
              data-active={active ? 'true' : 'false'}
              onClick={() => onSelect(s)}
              aria-current={active ? 'page' : undefined}
              title={DASHBOARD_SECTION_LABEL[s]}
            >
              <span className={styles.itemIcon} aria-hidden>
                <Icon size={20} />
              </span>
              <span className={styles.itemLabel}>{DASHBOARD_SECTION_LABEL[s]}</span>
              {s === 'collection' && collectionCount > 0 ? (
                <span className={styles.badge} aria-label={`${collectionCount} 个收藏`}>
                  {collectionCount}
                </span>
              ) : null}
              {/* 折叠 rail 态的自定义 tooltip（替原生 title，见 .tip） */}
              <span className={styles.tip} aria-hidden>
                {DASHBOARD_SECTION_LABEL[s]}
              </span>
            </button>
          );
        })}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.footer} ref={footerRef}>
        {/* 头像按钮：折叠 / 展开态都显示；点击展开迷你名片（账号菜单）。 */}
        <button
          type="button"
          className={styles.profile}
          onClick={() => setCardOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={cardOpen}
          title="账号菜单"
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
        {/* 点击头像展开迷你名片：账号信息 + 设置入口。登出已移出侧边栏。 */}
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
          <button
            type="button"
            className={styles.cardItem}
            onClick={() => {
              setCardOpen(false);
              onSelect('settings');
            }}
            role="menuitem"
          >
            设置
          </button>
        </div>
      </div>
    </aside>
  );
}
