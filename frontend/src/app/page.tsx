'use client';

import { useEffect, useState, useCallback } from 'react';
import { getContentCatalog, Catalog } from './api';
import LessonList from './LessonList';
import LessonSession from './LessonSession';

/**
 * Practice page — top-level router for the Target-Word Lesson flow.
 *
 *   ?lib=X            → lesson list for lib X (the home screen)
 *   ?lib=X&lesson=Y   → lesson session for lesson Y of lib X
 *
 * The home screen and the session share a single page (no Next.js
 * dynamic routes needed) so the design's single-column meditative
 * layout doesn't get interrupted by a route change. The query string
 * is the only state — refreshing on a lesson page takes the user
 * straight back to that lesson.
 *
 * Persistence: the selected libId is in localStorage (`prefs.libId`).
 * The active lessonIndex is in the URL (per-page ephemeral state,
 * matching how the original page.tsx treated `selectedLibId`).
 */
export default function PracticePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);

  // Read ?lib and ?lesson from the URL. Defaults: no lib → first
  // loaded lib; no lesson → lesson list.
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

  const [urlState, setUrlState] = useState<{ lib: string | null; lesson: number | null }>(
    { lib: null, lesson: null }
  );

  // Catalog + initial lib resolution.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getContentCatalog();
        if (cancelled) return;
        if (c.libs.length === 0) return;
        setCatalog(c);

        const initial = readUrl();
        if (initial.lib && c.libs.some((l) => l.id === initial.lib)) {
          setSelectedLibId(initial.lib);
        } else {
          // Fall back to localStorage or first lib.
          const savedLibId = (() => {
            try { return window.localStorage.getItem('prefs.libId'); } catch { return null; }
          })();
          const lib =
            c.libs.find((l) => l.id === savedLibId) ?? c.libs[0];
          setSelectedLibId(lib.id);
        }
        setUrlState(readUrl());
      } catch {
        // lesson components will surface their own errors
      }
    })();
    return () => { cancelled = true; };
  }, [readUrl]);

  // Persist the selected libId to localStorage. Same pattern as the
  // original page.tsx's `handlePickerChange`.
  useEffect(() => {
    if (!selectedLibId) return;
    try {
      window.localStorage.setItem('prefs.libId', selectedLibId);
    } catch { /* 隐私模式静默 */ }
  }, [selectedLibId]);

  // Update the URL when entering a lesson (history.pushState so the
  // back button works as expected).
  const navigateToLesson = useCallback((libId: string, lessonIndex: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set('lib', libId);
    url.searchParams.set('lesson', String(lessonIndex));
    window.history.pushState({}, '', url.toString());
    setUrlState({ lib: libId, lesson: lessonIndex });
  }, []);

  const navigateToList = useCallback((libId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('lib', libId);
    url.searchParams.delete('lesson');
    window.history.pushState({}, '', url.toString());
    setUrlState({ lib: libId, lesson: null });
  }, []);

  // Back/forward button support: re-read URL on popstate.
  useEffect(() => {
    const onPop = () => setUrlState(readUrl());
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

  if (!catalog || !selectedLibId) {
    return (
      <div className="practice practice--loading">
        <div className="practice__loader" aria-hidden>
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <p className="practice__loader-text">Loading…</p>
      </div>
    );
  }

  const activeLesson = urlState.lesson;

  return (
    <div className="practice">
      <div className="practice__content">
        <header className="masthead" aria-label="page header">
          <h1 className="masthead__brand">lessons.</h1>
        </header>

        {activeLesson !== null ? (
          <LessonSession
            libId={selectedLibId}
            lessonIndex={activeLesson}
            onBack={() => navigateToList(selectedLibId)}
            onNextLesson={() => navigateToLesson(selectedLibId, activeLesson + 1)}
          />
        ) : (
          <LessonList
            selectedLibId={selectedLibId}
            onSelectLesson={(idx) => navigateToLesson(selectedLibId, idx)}
          />
        )}
      </div>
    </div>
  );
}
