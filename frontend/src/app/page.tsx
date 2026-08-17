'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getContentCatalog,
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from './api';
import LandingPage from './landing';
import LoadingMark from './components/LoadingMark';
import TranslationSession from './TranslationSession';
import { useAuth } from './lib/auth';
import { useAuthModal } from './lib/authModal';
import styles from './practice/Practice.module.css';

/**
 * Practice page — top-level router for the translation drill.
 *
 * URL conventions (single-route + query-string state machine, so
 * refreshing on a lesson page takes the user straight back):
 *
 *   /            → LandingPage (anonymous) or /dashboard redirect (logged-in)
 *   /?lib=X      → TranslationSession for lib X (random-step drill)
 *
 * Auth-aware `/`:
 *   - Anonymous users see LandingPage — the content-driven marketing
 *     surface that introduces the lib market and daily plan.
 *   - Logged-in users get redirected to /dashboard (their working
 *     bench). The "landing page is for marketing visitors" split is
 *     deliberate — selecting a lib is a dashboard action for signed-
 *     in users (see dashboard/page.tsx::practiceMode), not a page-
 *     routing decision at the root.
 *   - `?lib=X` is always honored regardless of auth state — it's a
 *     deep link into a specific lesson (e.g. /me's CollectionTab
 *     "练这句" → /?lib=X&sentence=Y). Login redirect would feel
 *     hostile here ("I clicked a sent link and got bounced").
 *
 * Persistence: `prefs.libId` is still written to localStorage on
 * selection, but NOT read back on init — the dashboard reads it on
 * its own to drive the "继续上次" affordance.
 */
export default function PracticePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { open: openAuthModal } = useAuthModal();

  // Auth-aware root redirect: logged-in users see /dashboard, not
  // the marketing Landing. Wait for `authLoading` to resolve first
  // so we don't flash Landing at a signed-in user during the
  // initial /api/auth/me round-trip.
  useEffect(() => {
    if (authLoading) return;
    // `?lib=X` always wins — a deep link into a lesson should not
    // get bounced through /dashboard.
    const params =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : null;
    if (params?.get('lib')) return;
    if (user) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translationProgress, setTranslationProgress] =
    useState<TranslationProgress>({});
  const [error, setError] = useState('');
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);

  // Read ?lib from the URL. Default: no lib → null (Landing renders).
  const readUrl = useCallback(() => {
    if (typeof window === 'undefined') return { lib: null };
    const params = new URLSearchParams(window.location.search);
    return { lib: params.get('lib') };
  }, []);

  // Catalog + initial lib resolution.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, tp] = await Promise.all([
          getContentCatalog(),
          Promise.resolve(loadTranslationProgress()),
        ]);
        if (cancelled) return;
        // NOTE: do NOT early-return on an empty catalog here. Setting the
        // catalog (even with libs: []) lets the render below reach its
        // "暂无课程" empty-state branch. The previous early `return` left
        // `catalog` null forever, so the page was stuck on the
        // `!catalog` Loading branch with no error — a silent hang.
        setCatalog(c);
        setTranslationProgress(tp);

        // Initial route resolution:
        //   - URL `?lib=X`            → TranslationSession for lib X
        //   - no URL params           → LandingPage (always)
        //
        // LandingPage is the canonical landing surface. We do NOT
        // auto-resume from `prefs.libId` (the last-picked lib) — the
        // user wants Landing every time they land on `/` without
        // query params. `prefs.libId` is still written (for the
        // LandingPage's "继续上次" CTA), but ignored on init.
        const initial = readUrl();
        if (initial.lib && c.libs.some((l) => l.id === initial.lib)) {
          setSelectedLibId(initial.lib);
        }
        // else: leave selectedLibId null → LandingPage renders.
      } catch {
        // getContentCatalog rejected (network / 5xx / timeout) — without
        // surfacing an error here `catalog` stays null and the page loops
        // the `!catalog → Loading` branch forever. Show a message instead.
        setError('内容加载失败，请检查后端服务是否在运行后刷新重试。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readUrl]);

  // Persist selected libId so the LandingPage's "继续上次" CTA knows
  // which lib to deep-link into. Reads are owned by LandingPage itself.
  useEffect(() => {
    if (!selectedLibId) return;
    try {
      window.localStorage.setItem('prefs.libId', selectedLibId);
    } catch {
      /* 隐私模式静默 */
    }
  }, [selectedLibId]);

  // Update the URL when entering a lib (history.pushState so the back
  // button works as expected).
  const pushUrl = useCallback((libId: string | null) => {
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.search = '';
    if (libId != null) {
      url.searchParams.set('lib', libId);
    }
    window.history.pushState({}, '', url.toString());
  }, []);

  const navigateToSession = useCallback(
    (libId: string) => {
      // 无游客模式:未登录先弹注册,注册完成后再由用户从 /dashboard 进入练习。
      if (!user) {
        openAuthModal('signup');
        return;
      }
      pushUrl(libId);
      setSelectedLibId(libId);
    },
    [pushUrl, user, openAuthModal]
  );

  // Navigate to landing (clear ?lib=).
  const navigateToLanding = useCallback(() => {
    pushUrl(null);
    setSelectedLibId(null);
  }, [pushUrl]);

  // Back/forward button support: re-read URL on popstate so the
  // selected libId follows history.
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setSelectedLibId(u.lib);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [readUrl]);

  // ---- Render ----
  // Auth-aware root: while the auth state is hydrating, show a
  // loader instead of Landing to avoid flashing the marketing page
  // at a signed-in user. Once we know they're anonymous, fall
  // through to the normal Landing render.
  if (authLoading) {
    return (
      <div className={`${styles.root} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }
  // Logged-in + no `?lib=X` → /dashboard. Render nothing in the
  // window between the auth check and router.replace firing; the
  // route swap is effectively immediate but we don't want Landing
  // to paint underneath.
  const hasLibParam =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('lib') !== null;
  if (user && !hasLibParam) {
    return (
      <div className={`${styles.root} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.root} ${styles.error}`}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className={`${styles.root} ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }

  // Empty catalog — manifest shipped no libs (or all CSVs missing).
  if (catalog.libs.length === 0) {
    return (
      <div className={`${styles.root} ${styles.empty}`}>
        <p className={styles.emptyText}>暂无课程</p>
        <p className={styles.emptyHint}>
          请检查 <code>db/cms/manifest.yaml</code> 与对应 CSV 文件
        </p>
      </div>
    );
  }

  // Only anonymous visitors (or anyone following a `?lib=X` deep
  // link) reach this point — logged-in users without `?lib` were
  // already bounced to /dashboard above, where lib selection is an
  // in-place dashboard action (dashboard/page.tsx::practiceMode).

  // No lib selected → render LandingPage (the content-driven home).
  if (!selectedLibId) {
    return (
      <LandingPage
        libs={catalog.libs}
        translationProgress={translationProgress}
        onPickLib={navigateToSession}
      />
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <header className={styles.masthead} aria-label="page header">
          <a
            className={styles.mastheadBrand}
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateToLanding();
            }}
          >
            ← 返回
          </a>
        </header>

        <TranslationSession
          libId={selectedLibId}
          onBack={navigateToLanding}
        />
      </div>
    </div>
  );
}
