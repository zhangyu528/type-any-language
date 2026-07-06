'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getContentCatalog,
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
} from './api';
import Home from './Home';
import TranslationLessonList from './TranslationLessonList';
import TranslationSession from './TranslationSession';

/**
 * Practice page — top-level router for the translation drill.
 *
 * URL conventions (single-route + query-string state machine, so
 * refreshing on a lesson page takes the user straight back):
 *
 *   /                       → lib picker (if multi-lib catalog),
 *                             or straight into the only lib
 *   /?lib=X                 → TranslationLessonList for lib X
 *   /?lib=X&lesson=N        → TranslationSession for lib X / N
 *
 * Translation is the only mode. There is no listening/dictation
 * surface — the dictation ladder (LessonList / LessonSession /
 * RecognitionStage / DictationStage) was removed entirely.
 *
 * Persistence: selected libId lives in localStorage (`prefs.libId`).
 */
export default function PracticePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translationProgress, setTranslationProgress] =
    useState<TranslationProgress>({});
  const [error, setError] = useState('');
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);

  // Read ?lib and ?lesson from the URL. Defaults: no lib → first
  // loaded lib (or picker if multi-lib); no lesson → lesson list.
  const readUrl = useCallback(() => {
    if (typeof window === 'undefined') return { lib: null, lesson: null };
    const params = new URLSearchParams(window.location.search);
    const lib = params.get('lib');
    const lessonRaw = params.get('lesson');
    const lesson = lessonRaw ? parseInt(lessonRaw, 10) : null;
    return {
      lib,
      lesson: lesson !== null && !isNaN(lesson) ? lesson : null,
    };
  }, []);

  const [urlState, setUrlState] = useState<{
    lib: string | null;
    lesson: number | null;
  }>({ lib: null, lesson: null });

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

        const initial = readUrl();
        if (initial.lib && c.libs.some((l) => l.id === initial.lib)) {
          setSelectedLibId(initial.lib);
        } else {
          // Fall back to localStorage. Skip auto-pick when there are
          // multiple libs and no memory — Home should render instead.
          const savedLibId = (() => {
            try {
              return window.localStorage.getItem('prefs.libId');
            } catch {
              return null;
            }
          })();
          const remembered = savedLibId
            ? c.libs.find((l) => l.id === savedLibId)
            : undefined;
          if (remembered) {
            setSelectedLibId(remembered.id);
          } else if (c.libs.length === 1) {
            // Single-lib catalog: skip the picker, jump straight in.
            setSelectedLibId(c.libs[0].id);
          }
          // else: leave selectedLibId null → Home renders.
        }
        setUrlState(readUrl());
      } catch {
        // lesson components will surface their own errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readUrl]);

  // Persist selected libId so the next visit resumes on the same lib.
  useEffect(() => {
    if (!selectedLibId) return;
    try {
      window.localStorage.setItem('prefs.libId', selectedLibId);
    } catch {
      /* 隐私模式静默 */
    }
  }, [selectedLibId]);

  // Update the URL when entering a lesson (history.pushState so the
  // back button works as expected).
  const pushUrl = useCallback(
    (params: { lib: string; lesson?: number | null }) => {
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.search = '';
      url.searchParams.set('lib', params.lib);
      if (params.lesson != null) {
        url.searchParams.set('lesson', String(params.lesson));
      }
      window.history.pushState({}, '', url.toString());
    },
    []
  );

  const navigateToLesson = useCallback(
    (libId: string, lessonIndex: number) => {
      pushUrl({ lib: libId, lesson: lessonIndex });
      setSelectedLibId(libId);
      setUrlState({ lib: libId, lesson: lessonIndex });
    },
    [pushUrl]
  );

  const navigateToList = useCallback(
    (libId: string) => {
      pushUrl({ lib: libId, lesson: null });
      setSelectedLibId(libId);
      setUrlState({ lib: libId, lesson: null });
    },
    [pushUrl]
  );

  // Navigate to home picker (clear ?lib= and ?lesson=). Without this
  // a remembered `prefs.libId` would silently route every visit past
  // Home and there'd be no UI to get back to the picker.
  const navigateToHome = useCallback(() => {
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.search = '';
    window.history.pushState({}, '', url.toString());
    setSelectedLibId(null);
    setUrlState({ lib: null, lesson: null });
  }, []);

  // Back/forward button support: re-read URL on popstate so the
  // selected libId follows history.
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setSelectedLibId(u.lib);
      setUrlState(u);
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

  // Multi-lib catalog with no remembered selection → render Home picker.
  if (!selectedLibId) {
    return (
      <div className="practice">
        <div className="practice__content">
          <Home
            libs={catalog.libs}
            translationProgress={translationProgress}
            onPickLib={(libId) => navigateToList(libId)}
          />
        </div>
      </div>
    );
  }

  const activeLesson = urlState.lesson;

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
            translate.
          </a>
        </header>

        {activeLesson !== null ? (
          <TranslationSession
            libId={selectedLibId}
            lessonIndex={activeLesson}
            onBack={() => navigateToList(selectedLibId)}
            onNextLesson={() => navigateToLesson(selectedLibId, activeLesson + 1)}
          />
        ) : (
          <TranslationLessonList
            selectedLibId={selectedLibId}
            onSelectLesson={(idx) => navigateToLesson(selectedLibId, idx)}
            onSwitchLib={(newLibId) => navigateToList(newLibId)}
          />
        )}
      </div>
    </div>
  );
}
