'use client';

import { useEffect, useState, useRef } from 'react';
import { getContentCatalog, Catalog, VocabularyLib } from './api';

interface LibraryPickerProps {
  /** Currently selected lib id (VocabularyLib.id, a UUID). */
  selectedLibId: string | null;
  /** Called whenever the user picks a new lib. */
  onChange: (libId: string) => void;
  /** Disable while a sentence batch is loading; prevents mid-flight swaps. */
  disabled?: boolean;
}

/**
 * LibraryPicker — Apple HIG, web-adapted
 *
 * A custom popover menu. The native <select> was removed because its
 * dropdown is platform-controlled (and dismisses itself on mouseup on
 * many setups, which is exactly what we couldn't fix). Now the card is
 * a <button> that toggles a role="listbox" popover anchored below it.
 *
 * - Closes on: outside click / touch, Escape, option select
 * - Single lib → static card, no chevron, no popover
 * - Active lib → checkmark on the right
 */
export default function LibraryPicker(props: LibraryPickerProps) {
  const { selectedLibId, onChange, disabled = false } = props;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string>('');
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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

  // Close on outside pointer + Escape. Re-binds when open flips.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        cardRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

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
        <span className="picker__skeleton" aria-hidden="true" />
      </div>
    );
  }

  const activeLib: VocabularyLib =
    catalog.libs.find((l) => l.id === selectedLibId) ?? catalog.libs[0];
  const hasMultiple = catalog.libs.length > 1;

  return (
    <div className={`picker${disabled ? ' picker--disabled' : ''}`}>
      <span className="picker__label" id="picker-lib-label">当前词库</span>

      {hasMultiple ? (
        <div className="picker__field">
          <button
            ref={cardRef}
            type="button"
            className={`picker__card${open ? ' picker__card--open' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby="picker-lib-label"
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="picker__card-text">
              <span className="picker__card-name">{activeLib.name}</span>
              <span className="picker__card-meta">
                {activeLib.level} · {activeLib.word_count} 词
              </span>
            </span>
            <span
              className={`picker__chevron${open ? ' picker__chevron--open' : ''}`}
              aria-hidden="true"
            >
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
          </button>

          {open && (
            <div
              ref={popoverRef}
              className="picker__popover"
              role="listbox"
              aria-labelledby="picker-lib-label"
            >
              {catalog.libs.map((lib) => {
                const isActive = lib.id === activeLib.id;
                return (
                  <button
                    key={lib.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`picker__option${isActive ? ' picker__option--active' : ''}`}
                    onClick={() => {
                      if (lib.id !== activeLib.id) {
                        onChange(lib.id);
                      }
                      setOpen(false);
                    }}
                  >
                    <span className="picker__option-text">
                      <span className="picker__option-name">{lib.name}</span>
                      <span className="picker__option-meta">
                        {lib.level} · {lib.word_count} 词
                      </span>
                    </span>
                    {isActive && (
                      <svg
                        className="picker__option-check"
                        viewBox="0 0 12 12"
                        width="12"
                        height="12"
                        aria-hidden="true"
                      >
                        <path
                          d="M2 6 L5 9 L10 3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // Single lib: static display, no chevron, not clickable.
        <div className="picker__field">
          <div className="picker__card picker__card--static">
            <span className="picker__card-text">
              <span className="picker__card-name">{activeLib.name}</span>
              <span className="picker__card-meta">
                {activeLib.level} · {activeLib.word_count} 词
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
