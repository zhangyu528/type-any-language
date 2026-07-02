'use client';

const SHORTCUTS: ReadonlyArray<{ keys: ReadonlyArray<string>; label: string }> = [
  { keys: ['Space'],        label: '播放 / 暂停' },
  { keys: ['Tab'],          label: '下一词' },
  { keys: ['Shift', 'Tab'], label: '上一词' },
  { keys: ['/'],            label: '偷看' },
];

interface AutoPlayToggle {
  active: boolean;
  onToggle: () => void;
}

interface SunkenShortcutBarProps {
  /**
   * When provided, renders a 5th interactive row at the end of the bar —
   * the autoPlay toggle. Whole row is clickable, role="button" +
   * aria-pressed for screen readers, Enter activates. Space is intentionally
   * NOT captured here so the global Space=play/pause still works when the
   * toggle has focus.
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
 * Optional 5th row: autoPlay toggle. Same row visual language as the other
 * shortcuts (kbd badge + label), but the row is interactive — click or
 * Enter to flip. State suffix "· 开" / "· 关" + subtle color shift signals
 * current value. The whole row has hover bg + focus ring.
 */
export default function SunkenShortcutBar({ autoPlay }: SunkenShortcutBarProps = {}) {
  return (
    <section className="shortcuts-bar" aria-label="快捷键参考">
      <div className="shortcuts-bar__list">
        {SHORTCUTS.map((sc) => (
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