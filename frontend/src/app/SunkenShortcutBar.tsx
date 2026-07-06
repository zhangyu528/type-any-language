'use client';

interface AutoPlayToggle {
  active: boolean;
  onToggle: () => void;
}

interface SunkenShortcutBarProps {
  /**
   * Mode-specific shortcut hints to render. Required — the bar should
   * always reflect the keys the user can actually use in the current
   * mode, not a fixed default. TranslationStage is the only caller and
   * always supplies a translation-specific list (Cmd+Enter for check,
   * Tab for retry, optional Space for audio replay).
   */
  hints: ReadonlyArray<{ keys: ReadonlyArray<string>; label: string }>;
  /**
   * When provided, renders an additional interactive row at the end of
   * the bar — the autoPlay toggle. Whole row is clickable, role="button" +
   * aria-pressed for screen readers, Enter activates. Space is intentionally
   * NOT captured here so a parent Space=play/pause handler still works when
   * the toggle has focus.
   *
   * Currently unused (translation mode has no autoPlay concept); kept
   * available in case a future mode wants it.
   */
  autoPlay?: AutoPlayToggle;
}

/**
 * Sunken shortcut bar — DESIGN.md v2d.
 *
 * Lives inline in the practice column (NOT floating, NOT in a drawer).
 * All shortcuts flow on a single horizontal line: kbd badge(s) + label,
 * gap-separated. Wraps to the next line on narrow screens. Compact, like
 * a "key bindings" hint strip in a code editor's status bar.
 *
 * `hints` is required — the caller owns the binding list. No fixed
 * default; each mode declares its own binding set.
 */
export default function SunkenShortcutBar({
  hints,
  autoPlay,
}: SunkenShortcutBarProps) {
  return (
    <section className="shortcuts-bar" aria-label="快捷键参考">
      <div className="shortcuts-bar__list">
        {hints.map((sc) => (
          <div key={sc.label} className="shortcuts-bar__row">
            <span className="shortcuts-bar__keys">
              {sc.keys.map((k, i) => (
                <kbd key={i} className="shortcuts-bar__kbd">
                  {k}
                </kbd>
              ))}
            </span>
            <span className="shortcuts-bar__label">{sc.label}</span>
          </div>
        ))}
        {autoPlay && (
          <div
            className="shortcuts-bar__row shortcuts-bar__row--toggle"
            role="button"
            tabIndex={0}
            aria-pressed={autoPlay.active}
            aria-label={`自动播放${autoPlay.active ? ' · 开' : ' · 关'},点击切换`}
            onClick={autoPlay.onToggle}
            onKeyDown={(e) => {
              // Enter 触发切换;Space 不拦截 — 让全局 Space=播放/暂停 继续生效。
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                autoPlay.onToggle();
              }
            }}
          >
            <span className="shortcuts-bar__keys">
              <kbd className="shortcuts-bar__kbd">A</kbd>
            </span>
            <span className="shortcuts-bar__label">
              自动播放
              <span
                className={
                  'shortcuts-bar__state shortcuts-bar__state--' +
                  (autoPlay.active ? 'on' : 'off')
                }
              >
                {autoPlay.active ? '· 开' : '· 关'}
              </span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}