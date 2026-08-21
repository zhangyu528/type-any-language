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

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
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
import { ToastProvider, useToast } from '../components/Toast';
import DashboardNav from './DashboardNav';
import OverviewSection from './sections/OverviewSection';
import PracticeSection, { type CourseTab } from './sections/PracticeSection';
import AchievementsSection from './sections/AchievementsSection';
import ReviewSection from './sections/ReviewSection';
import SettingsSection from './sections/SettingsSection';
import LibPicker from './LibPicker';
import FirstRunGuide from './sections/FirstRunGuide';
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
    <ToastProvider>
      <Suspense fallback={<DashboardLoading />}>
        <DashboardInner />
      </Suspense>
    </ToastProvider>
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
  const toast = useToast();

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

  // ---- 首跑欢迎 Hero(FirstRunGuide):整页覆盖层 ----
  // 触发条件=「新用户注册进入」:注册落地 URL 带 ?welcome=1(选词库注册与通用注册
  // 两种 flow 都带此参;登录不带),故只要带此参即视为「刚注册进来」,直接进引导页。
  // 不依赖 isFirstRun / has_any_activity 等其他条件——注册即弹,与是否练过无关。
  // 选词库注册落 ?section=practice 也照常整页覆盖,不再依赖落地分区。
  // 点「进入主页」→ 关掉并清掉 ?welcome=1(避免刷新/前进后退重弹)。
  const [guideDismissed, setGuideDismissed] = useState<boolean>(false);
  const enterHome = useCallback(() => {
    setGuideDismissed(true);
    // 用 Next 路由感知的 router.replace 清掉 ?welcome=1,
    // 不要用 window.history.replaceState —— 后者会让 Next 路由器的
    // 历史索引错位,导致紧随其后的 router.push(如「开始《X》」进 /practice)
    // 静默失效、URL 不跳转(实测:选词库注册点「开始《X》」停在 /dashboard)。
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('welcome');
      router.replace(`${url.pathname}${url.search}`);
    } catch {}
  }, [router]);

  const searchParams = useSearchParams();
  // 从 landing 选词库注册而来:承接所选词库,在"发现"tab 高亮(见 PracticeSection)。
  const pendingLibId = searchParams.get('lib');

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
  // 课程中心内部分页：「我的课程」/「课程库」。提到 page 级以便主页
  // 「查看全部 N 门」能直接深链进「我的课程」tab。
  const [courseTab, setCourseTab] = useState<CourseTab>('discover');
  // 我的课程集合（enrolled lib ids）。服务端是唯一真相；本地做乐观更新，
  // 选课/移除时立即反映到主页「我的课程」块与课程中心两个标签页。
  const [enrolledLibIds, setEnrolledLibIds] = useState<string[]>([]);

  // 合并服务端快照的 enrolled_lib_ids 与本地乐观态。选词库注册会自动
  // 加课:autoEnroll 副作用先乐观把 pendingLibId 写进 enrolledLibIds,
  // 再发 enroll POST;而初始 dashboard snapshot 的 GET 可能早于 POST 发出,
  // 返回时服务端还没该课(读不到),若直接用它覆盖会把乐观态 clobber 成空,
  // 表现为「我的课程」看不到刚加的课。故:本地已含 pendingLibId 但快照
  // 尚未含时,保留本地。POST 完成后 reload() 再拉一次即对齐服务端。
  const mergeEnrolled = useCallback(
    (prev: string[], server: string[] | undefined): string[] => {
      const s = server ?? [];
      if (pendingLibId && prev.includes(pendingLibId) && !s.includes(pendingLibId)) {
        return prev;
      }
      // 两端皆空时返回同一引用,避免每次 snapshot 拉取都生成新空数组
      // 触发无谓 re-render(内容相等但引用不同)。
      if (s.length === 0 && prev.length === 0) return prev;
      return s;
    },
    [pendingLibId],
  );

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
      setEnrolledLibIds((prev) => mergeEnrolled(prev, s.enrolled_lib_ids));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'dashboard 加载失败');
    }
  }, [mergeEnrolled]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getDashboardSnapshot();
        if (cancelled) return;
        setSnapshot(s);
        setEnrolledLibIds((prev) => mergeEnrolled(prev, s.enrolled_lib_ids));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'dashboard 加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, mergeEnrolled]);

  // ---- 跨标签页练习后回 dashboard 也能拿到最新 server 派生字段 ----
  // SPA 内 router.push 回 /dashboard 会重新挂载并走上面的 mount 拉取；
  // 但若练习在另一个标签页进行、本 tab 一直挂着，focus/可见时不会自动刷新，
  // 导致 streak.today_done / 本周 KPI / preferred_hour 停留在旧值。
  // 这里在页面重新可见时补一次 reload（幂等、廉价）。
  useEffect(() => {
    if (authLoading || !user) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [authLoading, user, reload]);

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

  // 选词库注册:欢迎页主按钮「开始《X》」→ 清掉注册标记 + 进入主页(概览分区),
  // 不再直接跳练习页(用户要求:选词库注册的开始动作落主页而非练习)。
  // 必须在 pendingLibId / setSection 声明之后(避免 TDZ)。
  const startSelectedCourse = useCallback(() => {
    enterHome();
    setSection('overview');
  }, [enterHome, setSection]);

  // Wraps setSection so selecting a partition on mobile also closes
  // the off-canvas drawer.
  const handleSelect = useCallback(
    (next: DashboardSection) => {
      setSection(next);
      setMobileOpen(false);
    },
    [setSection],
  );

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

  // 继续上次未完成的练习会话：路由到 /practice?session=<id>&lib=<id>&from=dashboard。
  // 前端 practice 页按 lib 加载；session 参数保留以兼容后端续练意图（api.ts 注释约定）。
  const handleResume = useCallback(() => {
    const c = snapshot?.continue;
    if (!c?.session_id || !c.lib_id) return;
    const params = new URLSearchParams();
    params.set('session', c.session_id);
    params.set('lib', c.lib_id);
    params.set('from', 'dashboard');
    router.push(`/practice?${params.toString()}`);
  }, [snapshot, router]);

  // ---- 我的课程：选课 / 移除（服务端为真相，本地乐观更新） ----
  // 乐观更新立即反映到主页「我的课程」块与课程中心两个标签页；
  // 失败则回滚到服务端真相（重新拉取 snapshot）。成功有 toast 反馈，
  // 退课额外给「撤销」入口（重新 enroll）。
  const handleEnroll = useCallback(
    async (libId: string) => {
      const name = catalog?.libs.find((l) => l.id === libId)?.name ?? '课程';
      setEnrolledLibIds((prev) => (prev.includes(libId) ? prev : [...prev, libId]));
      try {
        await apiEnrollCourse(libId);
        toast.show({ message: `已加入《${name}》到我的课程` });
        // enroll POST 成功后用服务端 enrolled_lib_ids 覆盖乐观态。
        // 否则初始 dashboard snapshot 拉取若在 POST 之前完成,会把乐观
        // 加入的课程 clobber 成空,表现为「我的课程」看不到刚加的课
        // (服务端其实已写入,刷新才出来)。重拉一次即与服务端对齐。
        void reload();
      } catch (e) {
        setEnrolledLibIds((prev) => prev.filter((id) => id !== libId));
        console.error('[courses] enroll failed', e);
      }
    },
    [toast, catalog, reload],
  );

  const handleUnenroll = useCallback(
    async (libId: string) => {
      const name = catalog?.libs.find((l) => l.id === libId)?.name ?? '课程';
      setEnrolledLibIds((prev) => prev.filter((id) => id !== libId));
      try {
        await apiUnenrollCourse(libId);
        toast.show({
          message: `已移除《${name}》`,
          actionLabel: '撤销',
          onAction: () => void handleEnroll(libId),
        });
      } catch (e) {
        void reload();
        console.error('[courses] unenroll failed', e);
      }
    },
    [toast, catalog, reload, handleEnroll],
  );

  // ---- 从 landing 选词库注册而来:自动把该词库加入"我的课程"并切到对应 tab ----
  // 放在 handleEnroll 之后,避免依赖数组在声明前访问(handleEnroll 的 TDZ)。
  const autoEnrollFired = useRef(false);
  useEffect(() => {
    if (autoEnrollFired.current) return;
    if (authLoading || !user) return;
    if (!pendingLibId) return;
    if (!catalog) return;
    const lib = catalog.libs.find((l) => l.id === pendingLibId);
    if (!lib) return;
    autoEnrollFired.current = true;
    // 选中的词库即「当前进行中课程」：写入 prefs.libId，供主页 ContinueCard /
    // 我的课程 锚定到所选词库（而非回退到旧的 beginner / libs[0]）。
    persistLib(pendingLibId);
    // 已加入就不重复调用;未加入则乐观加入(服务端幂等,失败回滚到真相)。
    if (!enrolledLibIds.includes(pendingLibId)) {
      void handleEnroll(pendingLibId);
    }
    // 不再切到「发现」的 mine tab：预选词库的用户应直接落主页（概览），
    // 由主页展示所选词库为当前课程，避免一进来就被推去「看别的词库」。
  }, [authLoading, user, pendingLibId, catalog, enrolledLibIds, handleEnroll, persistLib]);

  // 主页「查看全部 N 门课程」→ 跳到课程中心并定位「我的课程」tab。
  const handleOpenMyCourses = useCallback(() => {
    setCourseTab('mine');
    setSection('practice');
  }, [setSection]);

  const handleDailySaved = useCallback((next: DashboardSnapshot['daily_goal']) => {
    setSnapshot((prev) => (prev ? { ...prev, daily_goal: next } : prev));
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
            userId={user.id}
            enrolledLibIds={enrolledLibIds}
            onEnroll={handleEnroll}
            onUnenroll={handleUnenroll}
            courseTab={courseTab}
            onCourseTabChange={setCourseTab}
            pendingLibId={pendingLibId}
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
            onDailySaved={handleDailySaved}
          />
        );
      case 'overview':
      default:
        return (
          <OverviewSection
            snapshot={snapshot}
            catalog={catalog}
            onPickLib={openLibPicker}
            onStartLib={handlePickLib}
            onResume={handleResume}
            onSetCurrentLib={persistLib}
            onNavigate={handleSelect}
            enrolledLibIds={enrolledLibIds}
            onOpenMyCourses={handleOpenMyCourses}
            selectedLibId={pendingLibId}
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
        {(() => {
          // 首跑欢迎 Hero:整页覆盖,优先于任何分区(选词库注册落 ?section=practice
          // 也照常进欢迎页)。enrolledLibName 取 landing 承接的所选词库名。
          // 触发条件=「新用户注册进入」:URL 带 ?welcome=1(选词库注册与通用注册
          // 两种 flow 都带此参,登录不带),故「刚注册进来」即弹引导页,与是否练过
          // 无关。dashboard 守卫初始 authLoading=true 会早退、不会剥 query,
          // 故 ?welcome=1 能稳稳传到此处,无需 sessionStorage 之类额外信号。
          const welcomeParam = searchParams.get('welcome') === '1';
          const enrolledLibName =
            pendingLibId && catalog
              ? catalog.libs.find((l) => l.id === pendingLibId)?.name ?? null
              : null;
          if (welcomeParam && !guideDismissed) {
            return (
              <FirstRunGuide
                userName={snapshot.user.display_name}
                enrolledLibName={enrolledLibName}
                onEnterHome={enterHome}
                onStartCourse={pendingLibId ? startSelectedCourse : undefined}
              />
            );
          }
          return (
            <AnimatedContent
              key={uiState.section}
              distance={12}
              direction="vertical"
              className={styles.sectionWrap}
            >
              {renderSection()}
            </AnimatedContent>
          );
        })()}
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
