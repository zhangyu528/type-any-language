'use client';

/**
 * /dashboard — login-required workbench page.
 *
 * Layout (Immersive Hero style):
 *   ┌──────────────────────────────────────────────────┐
 *   │ AuroraBackground (fixed, full-screen)           │
 *   ├──────────────────────────────────────────────────┤
 *   │ HeroSection (greeting + streak + monthly bar)   │
 *   ├──────────────────────────────────────────────────┤
 *   │ ContinueCard  │  DailyGoal                     │
 *   ├──────────────────────────────────────────────────┤
 *   │ WeekRhythm (7 dots + 本周 X/7)                  │
 *   ├──────────────────────────────────────────────────┤
 *   │ ProgressSnapshot  (Accuracy · Sentences · Words)│
 *   └──────────────────────────────────────────────────┘
 *
 * Auth: useAuth() + redirect to /login?from=/dashboard if anonymous.
 * Data: GET /api/dashboard is the single hydration call.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import {
  DashboardSnapshot,
  Catalog,
  getContentCatalog,
  getDashboardSnapshot,
} from '../api';
import { useAuth } from '../lib/auth';
import Aurora from '@/components/Aurora';
import BorderGlow from '@/components/BorderGlow';
import AnimatedContent from '@/components/AnimatedContent';
import LoadingMark from '../components/LoadingMark';
import ModalShell from '../components/ModalShell';

import GreetingBar from './GreetingBar';
import ContinueCard from './ContinueCard';
import DailyGoal from './DailyGoal';
import WeekRhythm from './WeekRhythm';
import ProgressSnapshot from './ProgressSnapshot';
import LearnedLibProgress from './LearnedLibProgress';
import LibPicker from './LibPicker';
import styles from './Dashboard.module.css';

/**
 * The URL-derived practice state. `libId` non-null means in-session;
 * otherwise `pickerOpen` decides overview vs overview+modal.
 */
interface PracticeUrlState {
  pickerOpen: boolean;
}

const OVERVIEW: PracticeUrlState = { pickerOpen: false };

function readPracticeUrl(): PracticeUrlState {
  if (typeof window === 'undefined') return OVERVIEW;
  const params = new URLSearchParams(window.location.search);
  return { pickerOpen: params.get('picker') === '1' };
}

/** Build a /dashboard URL for the picker state. */
function buildPracticeUrl(next: PracticeUrlState): string {
  return next.pickerOpen ? '/dashboard?picker=1' : '/dashboard';
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
      <p className={styles.loadingText}>Loading…</p>
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();

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
    if (searchParams.get("welcome") !== "1") return;
    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem("tal.welcome.seen.v1") === "1";
    } catch {
      dismissed = false;
    }
    if (!dismissed) setShowWelcome(true);
  }, [searchParams]);
  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      window.sessionStorage.setItem("tal.welcome.seen.v1", "1");
    } catch {}
    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState({}, "", url.toString());
  }, []);
  // ---- Practice state: picker URL only ----
  const [practice, setPractice] = useState<PracticeUrlState>(readPracticeUrl);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Keep state in sync with browser Back/Forward. Also runs once on
  // mount, which is what makes the initial ?lib= / ?picker= read
  // correct under SSR hydration (readPracticeUrl returns OVERVIEW on
  // the server, so without this a refresh on ?lib=X would render
  // overview).
  useEffect(() => {
    const sync = () => setPractice(readPracticeUrl());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  // ---- Dashboard snapshot (overview data) ----
  const loadSnapshot = useCallback(async () => {
    try {
      const s = await getDashboardSnapshot();
      setSnapshot(s);
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
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'dashboard 加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  // Catalog is lazy: only the picker needs the full lib list.
  useEffect(() => {
    if (!practice.pickerOpen) return;
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
  }, [practice.pickerOpen, catalog, catalogError]);

  // Persist the active lib so ContinueCard / LibPicker can offer
  // "继续上次" on a later visit. This is the read counterpart to the
  // same key page.tsx writes on the anonymous path.
  // (The practice route also writes it when it loads.)
  const persistLib = useCallback((libId: string) => {
    try {
      window.localStorage.setItem('prefs.libId', libId);
    } catch {
      /* 隐私模式静默 */
    }
  }, []);

  // ---- History-writing navigation helpers ----
  // We drive history directly (pushState / replaceState) rather than
  // router.push: these are same-page state transitions, and Next's
  // router would remount the route subtree, throwing away the
  // snapshot + catalog we already hold.
  const go = useCallback(
    (next: PracticeUrlState, mode: 'push' | 'replace') => {
      const url = buildPracticeUrl(next);
      if (mode === 'push') window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
      setPractice(next);
    },
    []
  );

  const openLibPicker = useCallback(() => {
    go({ pickerOpen: true }, 'push');
  }, [go]);

  // P1-E: welcome banner CTA wires straight into the lib picker.
  const startFirstSentence = useCallback(() => {
    dismissWelcome();
    openLibPicker();
  }, [dismissWelcome, openLibPicker]);

  // Closing goes through history.back() so the pushed '?picker=1'
  // entry is consumed rather than stacked — otherwise open/close
  // three times and the user needs three Back presses to leave.
  const closeLibPicker = useCallback(() => {
    window.history.back();
  }, []);

  const handlePickLib = useCallback(
    (libId: string) => {
      persistLib(libId);
      router.push(`/practice?lib=${encodeURIComponent(libId)}&from=dashboard`);
    },
    [persistLib, router]
  );

  /**
   * Trusts `prefs.libId` directly instead of validating against the
   * catalog. Validating would mean either blocking on a catalog fetch
   * (a spinner between click and practice) or — as an earlier version
   * did — bailing to the picker whenever the catalog hadn't loaded
   * yet, which on a cold dashboard was *always*, making the
   * "jump straight in" path dead code. If the stored lib has since
   * been deleted, TranslationSession renders its own error state with
   * a back button; that's a rare, recoverable miss.
   */
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
            void loadSnapshot();
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!snapshot) return <DashboardLoading />;

  // -------- Overview, with the picker modal layered on top --------
  // The modal is a portal (ModalShell), so the tiles below stay
  // mounted and visible behind the scrim.
  return (
    <main className={styles.root}>
      {/* Aurora background - full screen, behind all content */}
      <Aurora className="fixed inset-0 z-0" />

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

      {/* Hero section - full width with aurora */}
      <section className={styles.hero}>
        <GreetingBar
          user={snapshot.user}
          streak={snapshot.streak}
          dailyGoal={snapshot.daily_goal}
          monthlyGoal={snapshot.monthly_goal}
        />
      </section>

      {/* Cards grid - glassmorphism + glow.
          AnimatedContent wraps each major section so when the user scrolls
          down they fade up in sequence. cardsGrid is on-screen at load
          (1440×980 viewport) — its IntersectionObserver fires
          immediately; weekRhythmSection / progressSection are below the
          fold and wait for scroll. */}
      <AnimatedContent distance={20} direction="vertical" className={styles.cardsGrid}>
        <div className={styles.cardGlass}>
          {/* ContinueCard 包一层 GlowCard:鼠标在卡上移动时,光标位置
             跟随一圈淡 slate 辉光,作为"主 CTA"卡的视觉重音。
             DailyGoal 暂不加(它不强调 hover 反馈,hover 是 stack 装饰)。 */}
          <BorderGlow
            className={styles.continueGlow}
            glowColor="143, 203, 240"
            glowRadius={40}
            glowIntensity={1.0}
          >
            <ContinueCard
              state={snapshot.continue}
              onResume={handleResume}
              onPickLib={openLibPicker}
            />
          </BorderGlow>
        </div>
        <div className={styles.cardGlass}>
          <DailyGoal
            state={snapshot.daily_goal}
            onStartPractice={handleStartPractice}
          />
        </div>
      </AnimatedContent>

      {/* Week rhythm - the current-week activity strip. Monthly
          goal progress lives in GreetingBar now (one signal, one place). */}
      <AnimatedContent distance={24} delay={120 / 1000} direction="vertical" className={styles.weekRhythmSection}>
        <WeekRhythm days={snapshot.calendar} />
      </AnimatedContent>

      {/* Progress section */}
      <AnimatedContent distance={24} delay={220 / 1000} direction="vertical" className={styles.progressSection}>
        <ProgressSnapshot kpis={snapshot.progress} />
        <LearnedLibProgress userId={snapshot.user.id} />
      </AnimatedContent>

      <ModalShell
        open={practice.pickerOpen}
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
            <p className={styles.loadingText}>Loading…</p>
          </div>
        ) : (
          <LibPicker libs={catalog.libs} onPick={handlePickLib} />
        )}
      </ModalShell>
    </main>
  );
}
