'use client';

/**
 * DashboardNav — fixed left sidebar for the learning console.
 *
 * Five sections (主页 / 练习 / 数据 / 收藏 / 设置). The URL `?section=`
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
  GraduationCap,
  Languages,
  LayoutDashboard,
  Pin,
  PinOff,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import styles from './DashboardNav.module.css';

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
  practice: '练习',
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
  /** Desktop effective collapse-to-rail state (collapsed unless pinned or hovered). */
  collapsed: boolean;
  /** When true the rail is locked open (pinned). */
  pinned: boolean;
  /** Toggle the pinned (locked-open) state. */
  onTogglePin: () => void;
  /** Hover/focus changes the transient expanded state (only meaningful when not pinned). */
  onHoverChange: (hovered: boolean) => void;
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
  onHoverChange,
  mobileOpen,
  onCloseMobile,
}: DashboardNavProps) {
  const initial = (user?.display_name || '?').trim().charAt(0).toUpperCase();

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      aria-label="学习控制台导航"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocusCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHoverChange(true);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHoverChange(false);
      }}
    >
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden>
          <Languages size={20} />
        </span>
        <span className={styles.brandName}>学习控制台</span>
        <button
          type="button"
          className={styles.closeMobile}
          onClick={onCloseMobile}
          aria-label="关闭菜单"
        >
          <X size={18} />
        </button>
      </div>

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
            </button>
          );
        })}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.profile}
          onClick={() => onSelect('settings')}
          title="账号设置"
          aria-label={`${user?.display_name ?? '账号'} · 设置`}
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
        <button
          type="button"
          className={styles.pinBtn}
          onClick={onTogglePin}
          aria-pressed={pinned}
          aria-label={pinned ? '取消固定侧边栏' : '固定侧边栏（保持展开）'}
          title={pinned ? '已固定：点击取消固定' : '固定侧边栏（保持展开）'}
        >
          {pinned ? <PinOff size={18} /> : <Pin size={18} />}
        </button>
      </div>
    </aside>
  );
}
