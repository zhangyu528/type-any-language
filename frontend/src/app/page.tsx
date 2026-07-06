'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getContentCatalog,
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from './api';
import Home from './Home';
import TranslationSession from './TranslationSession';

/**
 * Practice page — top-level router for the translation drill.
 *
 * URL conventions (single-route + query-string state machine, so
 * refreshing on a lesson page takes the user straight back):
 *
 *   /            → Home picker (always — the canonical landing)
 *   /?lib=X      → TranslationSession for lib X (random-step drill)
 *
 * Translation is the only mode. There is no listening/dictation
 * surface — the dictation ladder (LessonList / LessonSession /
 * RecognitionStage / DictationStage) was removed entirely.
 *
 * The "lesson" intermediate layer was removed too: clicking a lib
 * goes straight into a weighted random step drill (TranslationSession),
 * not a per-lesson picker.
 *
 * Persistence: `prefs.libId` is still written to localStorage on
 * selection, but NOT read back on init — Home is always the landing
 * page when the URL has no `?lib=` param.
 */
export default function PracticePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translationProgress, setTranslationProgress] =
    useState<TranslationProgress>({});
  const [error, setError] = useState('');
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);

  // Read ?lib from the URL. Default: no lib → null (Home renders).
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
        //   - no URL params           → Home picker (always)
        //
        // Home is the canonical landing surface. We do NOT auto-resume
        // from `prefs.libId` (the last-picked lib) — the user wants
        // Home every time they land on `/` without query params.
        // `prefs.libId` is still written (for any future cross-tab
        // sync / debug), but ignored on init.
        const initial = readUrl();
        if (initial.lib && c.libs.some((l) => l.id === initial.lib)) {
          setSelectedLibId(initial.lib);
        }
        // else: leave selectedLibId null → Home renders.
      } catch {
        // session / home will surface their own errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readUrl]);

  // Persist selected libId (debug / future cross-tab use). Reads of
  // this key have been intentionally removed from the init path above.
  useEffect(() => {
    if (!selectedLibId) return;
    try {
      window.localStorage.setItem('prefs.libId', selectedLibId);
    } catch {
      /* 隐私模式静默 */
    }
  }, [selectedLibId]);

  // Update the URL when entering a lib (history.pushState so the back
  // button works as expected). `?lesson=N` is gone — there's no
  // intermediate lesson picker anymore.
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

  // Navigate to home picker (clear ?lib=).
  const navigateToHome = useCallback(() => {
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
          请检查 <code>db/content/manifest.yaml</code> 与对应 CSV 文件
        </p>
      </div>
    );
  }

  // No lib selected → render Home picker. With a single-lib catalog
  // the parent page could auto-select, but the user has explicitly
  // asked for "always go to Home on /" — keep this branch unconditional.
  if (!selectedLibId) {
    return (
      <div className="practice">
        <div className="practice__content">
          <Home
            libs={catalog.libs}
            translationProgress={translationProgress}
            onPickLib={(libId) => navigateToSession(libId)}
          />
        </div>
      </div>
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
              navigateToHome();
            }}
          >
            ← 返回
          </a>
        </header>

        <TranslationSession
          libId={selectedLibId}
          onBack={navigateToHome}
        />
      </div>
    </div>
  );
}