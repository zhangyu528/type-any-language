'use client';

/**
 * /dashboard — login-required learning console.
 *
 * This page is the orchestrator for a 6-partition console
 * (主页 / 发现 / 复习 / 数据 / 成就 / 设置). URL `?section=` is the single
 * source of truth for the active partition (deep-linkable + browser
 * back/forward); the picker modal uses `?picker=1` on the same URL.
 *
 * Auth: useAuth() + redirect to /login?from=/dashboard if anonymous.
 * Data: GET /api/dashboard is the single hydration call; the catalog is
 * loaded eagerly (needed by the 发现 grid + the picker modal).
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Menu } from 'lucide-react';

import {
  Catalog,
  DashboardSnapshot,
  apiEnrollCourse,
  apiUnenrollCourse,
  getContentCatalog,
  getDashboardSnapshot,
} from '../api';
import {
  DashboardSection,
  DASHBOARD_SECTIONS,
} from './DashboardNav';
import { useAuth } from '../lib/auth';
import AnimatedContent from '@/components/AnimatedContent';
import LoadingMark from '../components/LoadingMark';
import ModalShell from '../components/ModalShell';
import DashboardNav from './DashboardNav';
import OverviewSection from './sections/OverviewSection';
import PracticeSection from './sections/PracticeSection';
import AchievementsSection from './sections/AchievementsSection';
import ReviewSection from './sections/ReviewSection';
import SettingsSection from './sections/SettingsSection';
import LibPicker from './LibPicker';
import styles from './Dashboard.module.css';

// DataSection is the heaviest partition (SVG chart + animations) — lazy
// load it so the overview/practice partitions paint without its bundle.
const DataSection = dynamic(() => import('./sections/DataSection'), {
  ssr: false,
  loading: () => <LoadingMark />,
});

interface UiState {
  section: DashboardSection;
  pickerOpen: boolean;
}

function readState(): UiState {
  if (typeof window === 'undefined') return { section: 'overview', pickerOpen: false };
  const params = new URLSearchParams(window.location.search);
  const s = params.get('section');
  const section: DashboardSection =
    s && (DASHBOARD_SECTIONS as string[]).includes(s) ? (s as DashboardSection) : 'overview';
  return { section, pickerOpen: params.get('picker') === '1' };
}

function buildUrl(state: UiState): string {
  const params = new URLSearchParams();
  if (state.section !== 'overview') params.set('section', state.section);
  if (state.pickerOpen) params.set('picker', '1');
  const qs = params.toString();
  return qs ? `/dashboard?${qs}` : '/dashboard';
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardLoading() {
  return (
    <div className={styles.loading}>
      <LoadingMark />
      <p className={styles.loadingText}>加载中…</p>
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading, logout } = useAuth();

  // Auth gate — mirror /me/page.tsx verbatim. The redirect target
  // uses the live pathname so back-nav after login lands the user
  // back on /dashboard.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const here = pathname || '/dashboard';
      router.replace(`/login?from=${encodeURIComponent(here)}`);
    }
  }, [authLoading, user, router, pathname]);

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- Welcome banner (P1-E) ----
  const searchParams = useSearchParams();
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (searchParams.get('welcome') !== '1') return;
    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem('tal.welcome.seen.v1') === '1';
    } catch {
      dismissed = false;
    }
    if (!dismissed) setShowWelcome(true);
  }, [searchParams]);
  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      window.sessionStorage.setItem('tal.welcome.seen.v1', '1');
    } catch {}
    const url = new URL(window.location.href);
    url.searchParams.delete('welcome');
    window.history.replaceState({}, '', url.toString());
  }, []);

  // ---- Partition + picker state (URL = source of truth) ----
  const [uiState, setUiState] = useState<UiState>(readState);
  // 侧边栏默认折叠(76px rail)；hover/focus 临时展开，pin 锁定展开。
  // pin 状态持久化到 localStorage，刷新后保持用户上次的锁定选择。
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('prefs.sidebarPinned') === '1';
    } catch {
      return false;
    }
  });
  // 侧边栏展开态 = 用户点击固定(pin)；默认折叠为 76px rail。
  // 不再用 hover 自动展开：hover 浮层会压住主显示区，hover 推内容又会造成
  // 割裂，故改为「点击伸缩按钮切换 + pin 持久化」(VS Code / Notion 模型)。
  // 内容区 margin 与侧栏宽度共用同一个 collapsed 标志（展开时让位，
  // 折叠时收为 rail），不再维护第二个同义变量。
  const collapsed = !pinned;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // 我的课程集合（enrolled lib ids）。服务端是唯一真相；本地做乐观更新，
  // 选课/移除时立即反映到主页「我的课程」块与课程中心两个标签页。
  const [enrolledLibIds, setEnrolledLibIds] = useState<string[]>([]);

  // Keep state in sync with browser Back/Forward.
  useEffect(() => {
    const sync = () => setUiState(readState());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  // ---- Dashboard snapshot (overview + section data) ----
  const reload = useCallback(async () => {
    try {
      const s = await getDashboardSnapshot();
      setSnapshot(s);
      setEnrolledLibIds(s.enrolled_lib_ids ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'dashboard 加载失败');
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getDashboardSnapshot();
        if (cancelled) return;
        setSnapshot(s);
        setEnrolledLibIds(s.enrolled_lib_ids ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'dashboard 加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  // ---- Catalog (eager — 练习 grid + picker both need it) ----
  useEffect(() => {
    if (!user) return;
    if (catalog || catalogError) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getContentCatalog();
        if (cancelled) return;
        setCatalog(c);
      } catch (e) {
        if (cancelled) return;
        setCatalogError(e instanceof Error ? e.message : '加载词库失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, catalog, catalogError]);

  // Persist the active lib so ContinueCard / LibPicker can offer
  // "继续上次" on a later visit.
  const persistLib = useCallback((libId: string) => {
    try {
      window.localStorage.setItem('prefs.libId', libId);
    } catch {
      /* 隐私模式静默 */
    }
  }, []);

  // ---- History-writing navigation helpers ----
  const openLibPicker = useCallback(() => {
    const url = buildUrl({ section: uiState.section, pickerOpen: true });
    window.history.pushState({}, '', url);
    setUiState((s) => ({ ...s, pickerOpen: true }));
  }, [uiState.section]);

  const setSection = useCallback(
    (next: DashboardSection) => {
      const url = buildUrl({ section: next, pickerOpen: uiState.pickerOpen });
      window.history.pushState({}, '', url);
      setUiState((s) => ({ ...s, section: next }));
    },
    [uiState.pickerOpen],
  );

  // Wraps setSection so selecting a partition on mobile also closes
  // the off-canvas drawer.
  const handleSelect = useCallback(
    (next: DashboardSection) => {
      setSection(next);
      setMobileOpen(false);
    },
    [setSection],
  );

  // P1-E: welcome banner CTA wires straight into the lib picker.
  const startFirstSentence = useCallback(() => {
    dismissWelcome();
    openLibPicker();
  }, [dismissWelcome, openLibPicker]);

  // Pin 锁定：切换时把状态持久化到 localStorage，刷新后保持。
  const togglePin = useCallback(() => {
    setPinned((p) => {
      const np = !p;
      try {
        window.localStorage.setItem('prefs.sidebarPinned', np ? '1' : '0');
      } catch {
        /* 隐私模式静默 */
      }
      return np;
    });
  }, []);

  // 登出（与 AppHeader 行为一致）：清会话后回 landing。
  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/');
  }, [logout, router]);

  // Closing goes through history.back() so the pushed '?picker=1'
  // entry is consumed rather than stacked.
  const closeLibPicker = useCallback(() => {
    window.history.back();
  }, []);

  const handlePickLib = useCallback(
    (libId: string) => {
      persistLib(libId);
      router.push(`/practice?lib=${encodeURIComponent(libId)}&from=dashboard`);
    },
    [persistLib, router],
  );

  const handleStartPractice = useCallback(() => {
    let recent: string | null = null;
    try {
      recent = window.localStorage.getItem('prefs.libId');
    } catch {
      recent = null;
    }
    if (recent) {
      persistLib(recent);
      router.push(`/practice?lib=${encodeURIComponent(recent)}&from=dashboard`);
    } else openLibPicker();
  }, [openLibPicker, persistLib, router]);

  const handleResume = useCallback(() => {
    const libId = snapshot?.continue.lib_id;
    if (libId) {
      persistLib(libId);
      router.push(`/practice?lib=${encodeURIComponent(libId)}&from=dashboard`);
    } else openLibPicker();
  }, [openLibPicker, persistLib, router, snapshot]);

  // ---- 我的课程：选课 / 移除（服务端为真相，本地乐观更新） ----
  // 乐观更新立即反映到主页「我的课程」块与课程中心两个标签页；
  // 失败则回滚到服务端真相（重新拉取 snapshot）。
  const handleEnroll = useCallback(async (libId: string) => {
    setEnrolledLibIds((prev) => (prev.includes(libId) ? prev : [...prev, libId]));
    try {
      await apiEnrollCourse(libId);
    } catch (e) {
      setEnrolledLibIds((prev) => prev.filter((id) => id !== libId));
      console.error('[courses] enroll failed', e);
    }
  }, []);

  const handleUnenroll = useCallback(
    async (libId: string) => {
      setEnrolledLibIds((prev) => prev.filter((id) => id !== libId));
      try {
        await apiUnenrollCourse(libId);
      } catch (e) {
        void reload();
        console.error('[courses] unenroll failed', e);
      }
    },
    [reload],
  );

  const handleDailySaved = useCallback((next: DashboardSnapshot['daily_goal']) => {
    setSnapshot((prev) => (prev ? { ...prev, daily_goal: next } : prev));
  }, []);

  const handleMonthlySaved = useCallback((next: DashboardSnapshot['monthly_goal']) => {
    setSnapshot((prev) => (prev ? { ...prev, monthly_goal: next } : prev));
  }, []);

  if (authLoading || !user) return <DashboardLoading />;

  if (error) {
    return (
      <div className={styles.errorWrap}>
        <p className={styles.errorText}>{error}</p>
        <button
          type="button"
          className={styles.errorRetry}
          onClick={() => {
            setError(null);
            void reload();
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!snapshot) return <DashboardLoading />;

  const renderSection = () => {
    switch (uiState.section) {
      case 'practice':
        if (catalogError) {
          return (
            <div className={styles.errorWrap}>
              <p className={styles.errorText}>{catalogError}</p>
              <button
                type="button"
                className={styles.errorRetry}
                onClick={() => {
                  setCatalogError(null);
                  setCatalog(null);
                }}
              >
                重试
              </button>
            </div>
          );
        }
        return catalog ? (
          <PracticeSection
            catalog={catalog}
            onPickLib={handlePickLib}
            onStartPractice={handleStartPractice}
            userId={user.id}
            enrolledLibIds={enrolledLibIds}
            onEnroll={handleEnroll}
            onUnenroll={handleUnenroll}
          />
        ) : (
          <DashboardLoading />
        );
      case 'data':
        return <DataSection snapshot={snapshot} onStartLib={handlePickLib} />;
      case 'achievements':
        return <AchievementsSection snapshot={snapshot} />;
      case 'review':
        return (
          <ReviewSection
            catalog={catalog}
            catalogError={catalogError}
            userId={user.id}
          />
        );
      case 'settings':
        return (
          <SettingsSection
            dailyGoal={snapshot.daily_goal}
            monthlyGoal={snapshot.monthly_goal}
            onDailySaved={handleDailySaved}
            onMonthlySaved={handleMonthlySaved}
          />
        );
      case 'overview':
      default:
        return (
          <OverviewSection
            snapshot={snapshot}
            catalog={catalog}
            onResume={handleResume}
            onPickLib={openLibPicker}
            onStartLib={handlePickLib}
            onNavigate={handleSelect}
            enrolledLibIds={enrolledLibIds}
          />
        );
    }
  };

  return (
    <main
      className={styles.root}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
    >
      {/* Static baby-blue mesh background (replaces the old WebGL Aurora).
          Fixed, behind all content, non-interactive. */}
      <div className={styles.bgMesh} aria-hidden="true" />

      {/* Mobile top-left menu trigger */}
      <button
        type="button"
        className={styles.menuBtn}
        onClick={() => setMobileOpen(true)}
        aria-label="打开菜单"
      >
        <Menu size={22} />
      </button>

      {/* Mobile drawer scrim */}
      {mobileOpen ? (
        <div className={styles.scrim} onClick={() => setMobileOpen(false)} aria-hidden="true" />
      ) : null}

      <DashboardNav
        section={uiState.section}
        onSelect={handleSelect}
        reviewDue={snapshot.review_due_count ?? 0}
        user={user}
        onLogout={handleLogout}
        collapsed={collapsed}
        pinned={pinned}
        onTogglePin={togglePin}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={styles.content}>
        {/* Welcome banner (P1-E) */}
        {showWelcome ? (
          <div className={styles.welcomeWrap} role="status" aria-live="polite" data-testid="auth-welcome">
            <div className={styles.welcome}>
              <span className={styles.welcomeEmoji} aria-hidden>👋</span>
              <div className={styles.welcomeText}>
                <p className={styles.welcomeTitle}>{`欢迎加入，${user.display_name} ✨`}</p>
                <p className={styles.welcomeSubtitle}>跳过介绍，直接挑个词库开始第一句</p>
              </div>
              <button type="button" className={styles.welcomeCta} onClick={startFirstSentence}>开始第一句 →</button>
              <button type="button" className={styles.welcomeClose} onClick={dismissWelcome} aria-label="关闭欢迎横幅">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        <AnimatedContent
          key={uiState.section}
          distance={12}
          direction="vertical"
          className={styles.sectionWrap}
        >
          {renderSection()}
        </AnimatedContent>
      </div>

      <ModalShell
        open={uiState.pickerOpen}
        onClose={closeLibPicker}
        title="选一个词库开始"
        subtitle="选好后立即进入练习,返回后进度会保留。"
      >
        {catalogError ? (
          <div className={styles.modalState}>
            <p className={styles.errorText}>{catalogError}</p>
            <button
              type="button"
              className={styles.errorRetry}
              onClick={() => {
                setCatalogError(null);
                setCatalog(null);
              }}
            >
              重试
            </button>
          </div>
        ) : !catalog ? (
          <div className={styles.modalState}>
            <LoadingMark />
            <p className={styles.loadingText}>加载中…</p>
          </div>
        ) : (
          // 门禁：选词库弹窗只展示已加入「我的课程」的词库（先添加才能练）。
          <LibPicker
            libs={catalog.libs.filter((l) => enrolledLibIds.includes(l.id))}
            onPick={handlePickLib}
          />
        )}
      </ModalShell>
    </main>
  );
}
