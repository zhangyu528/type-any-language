'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getContentCatalog,
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from './api';
import { useAuth } from './lib/auth';
import LandingPage from './landing';
import TranslationSession from './TranslationSession';

/**
 * Practice page — top-level router for the translation drill.
 *
 * URL conventions (single-route + query-string state machine, so
 * refreshing on a lesson page takes the user straight back):
 *
 *   /            → LandingPage (the content-driven home)
 *   /?lib=X      → TranslationSession for lib X (random-step drill)
 *
 * The landing page is the canonical `/` surface. It hosts the hero,
 * daily plan, lib market, and daily word/sentence cards. The
 * TranslationSession is reachable via any `?lib=X` param.
 *
 * Persistence: `prefs.libId` is still written to localStorage on
 * selection, but NOT read back on init — LandingPage reads it on
 * its own to drive the "继续上次" CTA card.
 */
export default function PracticePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translationProgress, setTranslationProgress] =
    useState<TranslationProgress>({});
  const [error, setError] = useState('');
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

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
        if (c.libs.length === 0) return;
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
        // session / landing will surface their own errors
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
      pushUrl(libId);
      setSelectedLibId(libId);
    },
    [pushUrl]
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
  if (error) {
    return (
      <div className="practice practice--error">
        <p className="practice__error-text">{error}</p>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="practice practice--loading">
        <div className="practice__loader" aria-hidden>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  // Empty catalog — manifest shipped no libs (or all CSVs missing).
  if (catalog.libs.length === 0) {
    return (
      <div className="practice practice--empty">
        <p className="practice__empty-text">暂无课程</p>
        <p className="practice__empty-hint">
          请检查 <code>db/cms/manifest.yaml</code> 与对应 CSV 文件
        </p>
      </div>
    );
  }

  // LandingPage is the unauth-only home surface. Once auth resolves
  // and we have a user, bounce them to /history (the dashboard). We
  // wait for authLoading to finish so we don't flash LandingPage at
  // a logged-in user for one frame.
  if (!authLoading && user) {
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      router.replace('/history');
    }
    return (
      <div className="practice practice--loading">
        <div className="practice__loader" aria-hidden>
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span>
        </div>
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  // No lib selected → render LandingPage (the new content-driven home).
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
    <div className="practice">
      <div className="practice__content">
        <header className="masthead" aria-label="page header">
          <a
            className="masthead__brand"
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
