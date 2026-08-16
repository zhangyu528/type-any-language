'use client';

/**
 * DashboardNav — fixed left sidebar for the learning console.
 *
 * 六个分区，按语义分四组渲染（见 NAV_GROUPS）：
 *   主页（独立） · 学习「发现 / 复习」 · 回顾「数据 / 成就」 · 设置（沉底）
 * URL `?section=` 是单一真相源（可深链 + 浏览器前进/后退），与 /me 的
 * `?tab=` 同构。本组件是展示层：从 page.tsx 接收当前 `section` 与
 * `onSelect`，history.pushState 的接线由 page.tsx 负责。
 *
 * 布局：248px 玻璃侧栏，桌面可折叠为 76px 图标 rail，移动端变成
 * off-canvas 抽屉（由 `mobileOpen` / `onCloseMobile` 控制）。
 *
 * 键盘：↑↓ / Home / End 在分区间移动焦点（roving tabindex，整组只占
 * 一个 Tab 位）；Alt+1..6 直达对应分区；Esc 关闭账号名片，移动端抽屉
 * 打开时 Esc 关抽屉且 Tab 焦点锁在抽屉内。
 */

import Link from 'next/link';
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
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

interface NavGroup {
  key: string;
  /** 组标题；不传则该组无标题（主页 / 设置这类单项组）。 */
  label?: string;
  items: DashboardSection[];
}

/**
 * 分区分组 = 侧边栏视觉层次的单一真相源。
 * 「学习」是动作（去练 / 去复习），「回顾」是看结果（数据 / 成就），
 * 主页置顶、设置沉底。折叠 rail 态标题隐藏，改用组间细分隔线。
 */
const NAV_GROUPS: NavGroup[] = [
  { key: 'home', items: ['overview'] },
  { key: 'learn', label: '学习', items: ['practice', 'review'] },
  { key: 'recap', label: '回顾', items: ['data', 'achievements'] },
  { key: 'system', items: ['settings'] },
];

/** 扁平顺序（= 分组渲染顺序），供 URL 校验、键盘上下移动与 Alt+N 共用。 */
export const DASHBOARD_SECTIONS: DashboardSection[] = NAV_GROUPS.flatMap((g) => g.items);

export const DASHBOARD_SECTION_LABEL: Record<DashboardSection, string> = {
  overview: '主页',
  practice: '发现',
  data: '数据',
  achievements: '成就',
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

// package.json 的 version 由 next.config.js 注入，避免手工同步漂移。
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

export default function DashboardNav({
  section,
  onSelect,
  reviewDue = 0,
  user,
  onLogout,
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
        // 折叠 rail 态 label 不可见，靠 aria-label 提供可访问名；
        // 不用 title —— 原生 tooltip 会与自绘的 .tip 叠成两层。
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
        {/* 折叠 rail 态的自定义 tooltip（见 .tip） */}
        <span className={styles.tip} aria-hidden>
          {label}
        </span>
      </button>
    );
  };

  return (
    <aside
      ref={asideRef}
      className={styles.sidebar}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      aria-label="学习控制台导航"
    >
      {/* 伸缩(pin)控件：悬浮在侧边栏右边缘、与品牌区同高的圆形按钮。
         桌面 / 折叠 rail 通用；与导航项不同高，避免压住列表与内容中部。 */}
      <button
        type="button"
        className={styles.pinBtn}
        onClick={onTogglePin}
        aria-pressed={pinned}
        aria-label={pinned ? '收起侧边栏' : '展开侧边栏'}
      >
        {pinned ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
      </button>

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
        {NAV_GROUPS.map((g) => (
          <div key={g.key} className={styles.group}>
            {g.label ? (
              <span className={styles.groupLabel} aria-hidden>
                {g.label}
              </span>
            ) : null}
            {g.items.map(renderItem)}
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
