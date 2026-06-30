'use client';

import { useEffect, useState } from 'react';
import { getContentCatalog, Catalog, VocabularyLib } from './api';

interface LibraryPickerProps {
  /** Currently selected lib id (VocabularyLib.id, a UUID). */
  selectedLibId: string | null;
  /** Currently selected difficulty bucket. */
  selectedDifficulty: string;
  /** Called whenever the user picks a new (lib, difficulty) combo. */
  onChange: (libId: string, difficulty: string) => void;
  /** Disable while a sentence batch is loading; prevents mid-flight swaps. */
  disabled?: boolean;
}

export default function LibraryPicker(props: LibraryPickerProps) {
  const { selectedLibId, selectedDifficulty, onChange, disabled = false } = props;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getContentCatalog();
        if (!cancelled) setCatalog(c);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '无法加载内容目录');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="picker picker--error" role="status">
        <span className="picker__error-glyph" aria-hidden="true">·</span>
        <span className="picker__error-text">内容目录加载失败</span>
      </div>
    );
  }
  if (!catalog || catalog.libs.length === 0) {
    return (
      <div className="picker picker--loading" role="status" aria-live="polite">
        <span className="picker__skeleton picker__skeleton--select" aria-hidden="true" />
        <span className="picker__skeleton picker__skeleton--chips" aria-hidden="true" />
      </div>
    );
  }

  const activeLib: VocabularyLib | undefined =
    catalog.libs.find((l) => l.id === selectedLibId) ?? catalog.libs[0];

  // Per-lib difficulties; fall back to defaults if the lib isn't in the map.
  const availableDifficulties: string[] =
    catalog.difficulties_by_lib[activeLib.level] ?? [catalog.defaults.difficulty];

  // If the current selection isn't valid for this lib, snap to the first available.
  const effectiveDifficulty = availableDifficulties.includes(selectedDifficulty)
    ? selectedDifficulty
    : availableDifficulties[0];

  return (
    <div className={`picker${disabled ? ' picker--disabled' : ''}`}>
      {/* Library: Apple-style compact control wrapping a native <select> */}
      <div className="picker__field picker__field--library">
        <span className="picker__label" id="picker-lib-label">词库</span>
        <div className="picker__select-wrap">
          <select
            className="picker__select"
            value={activeLib.id}
            disabled={disabled}
            aria-labelledby="picker-lib-label"
            onChange={(e) => {
              const nextLib = catalog.libs.find((l) => l.id === e.target.value);
              if (!nextLib) return;
              const nextDiffs = catalog.difficulties_by_lib[nextLib.level] ?? availableDifficulties;
              // Keep current difficulty if it's available for the new lib; else snap.
              const nextDifficulty = nextDiffs.includes(effectiveDifficulty)
                ? effectiveDifficulty
                : nextDiffs[0];
              onChange(nextLib.id, nextDifficulty);
            }}
          >
            {catalog.libs.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.name} ({lib.word_count})
              </option>
            ))}
          </select>
          <span className="picker__chevron" aria-hidden="true">
            <svg viewBox="0 0 10 6" width="10" height="6">
              <path
                d="M1 1l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>

      {/* Difficulty: filled pill when active, transparent when not */}
      <div
        className="picker__field picker__field--chips"
        role="radiogroup"
        aria-labelledby="picker-diff-label"
      >
        <span className="picker__label" id="picker-diff-label">难度</span>
        <div className="picker__chips">
          {availableDifficulties.map((d) => {
            const isActive = d === effectiveDifficulty;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`picker__chip${isActive ? ' picker__chip--active' : ''}`}
                disabled={disabled}
                onClick={() => onChange(activeLib.id, d)}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
