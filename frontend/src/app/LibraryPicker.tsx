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
    return <div className="picker picker--error">内容目录加载失败</div>;
  }
  if (!catalog || catalog.libs.length === 0) {
    return <div className="picker picker--loading">加载中...</div>;
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
    <div className={`picker ${disabled ? 'picker--disabled' : ''}`}>
      <label className="picker__field">
        <span className="picker__label">词库</span>
        <select
          className="picker__select"
          value={activeLib.id}
          disabled={disabled}
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
      </label>

      <div className="picker__field picker__field--chips">
        <span className="picker__label">难度</span>
        <div className="picker__chips">
          {availableDifficulties.map((d) => (
            <button
              key={d}
              type="button"
              className={`picker__chip ${d === effectiveDifficulty ? 'picker__chip--active' : ''}`}
              disabled={disabled}
              onClick={() => onChange(activeLib.id, d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}