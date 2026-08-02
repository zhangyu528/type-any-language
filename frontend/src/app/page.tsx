'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getContentCatalog,
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from './api';
import LandingPage from './landing';
import LoadingMark from './components/LoadingMark';
import TranslationSession from './TranslationSession';
import styles from './practice/Practice.module.css';

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
      <div className={`${styles.root} practice--cm ${styles.error}`}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className={`${styles.root} practice--cm ${styles.loading}`}>
        <LoadingMark />
        <p className={styles.loaderText}>Loading…</p>
      </div>
    );
  }

  // Empty catalog — manifest shipped no libs (or all CSVs missing).
  if (catalog.libs.length === 0) {
    return (
      <div className={`${styles.root} practice--cm ${styles.empty}`}>
        <p className={styles.emptyText}>暂无课程</p>
        <p className={styles.emptyHint}>
          请检查 <code>db/cms/manifest.yaml</code> 与对应 CSV 文件
        </p>
      </div>
    );
  }

  // Logged-in users see the same Landing as anonymous visitors —
  // they pick a lib and dive into the drill. No dedicated dashboard
  // route exists anymore (the historical /history placeholder was
  // removed 2026-07-31; this page IS the home for everyone).

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
    <div className={`${styles.root} practice--cm`}>
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
