'use client';

/**
 * Practice page top chrome — brand + auth + 3-dot tools, full-width 36px.
 *
 * Replaces the root-layout <Header />. Sits inside PracticePage (rendered
 * alongside all 4 state branches: loading / error / score / normal) so the
 * practice flow owns its own navigation chrome. The root layout stays
 * chrome-free on `/` — the page knows what it needs.
 *
 * Visual: frosted glass (rgba white + backdrop-filter) with a hairline
 * border-bottom. Frosted instead of solid so the page background bleeds
 * through subtly, matching the macOS Big Sur nav-bar feel and the
 * glassmorphism already used on the (auth) route group.
 *
 * Brand on the left links home. Auth on the right: login pill for anon,
 * circular initial + small 登出 for signed-in (avatar links to /history
 * for one-click access to account). 3-dot tools menu (设置 / 主题 /
 * 功能引导) sits at the far right — same affordance as the old top-right
 * toolbar, just absorbed into the chrome.
 *
 * Hidden on mobile < 640px: brand name text (enso still visible). Logout
 * stays visible — narrow enough to fit alongside the avatar.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';

export function PracticeChrome() {
  const { user, loading, logout } = useAuth();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isToolsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (chromeRef.current && !chromeRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isToolsOpen]);

  const closeToolsAndAlert = (msg: string) => () => {
    setIsToolsOpen(false);
    alert(msg);
  };

  return (
    <div className="practice-chrome" ref={chromeRef}>
      {/* Left: brand — links home */}
      <Link href="/" className="practice-chrome__brand" aria-label="返回首页">
        <span className="practice-chrome__brand-mark" aria-hidden="true">◯</span>
        <span className="practice-chrome__brand-name">Type Any Language</span>
      </Link>

      {/* Right: auth + tools */}
      <div className="practice-chrome__right">
        {!loading && user ? (
          <>
            <Link
              href="/history"
              className="practice-chrome__avatar"
              aria-label={`${user.display_name} — 我的历史`}
              title={`${user.display_name} · 我的历史`}
            >
              {user.display_name.charAt(0).toUpperCase()}
            </Link>
            <button
              type="button"
              className="practice-chrome__logout"
              onClick={() => {
                void logout();
              }}
              aria-label="登出"
            >
              登出
            </button>
          </>
        ) : !loading ? (
          <Link href="/login" className="practice-chrome__login" aria-label="登录">
            登录
          </Link>
        ) : null}

        <div
          className="practice-chrome__tools"
          onKeyDown={(e) => {
            // 阻止键盘事件冒泡到 window listener（避免字母/空格被菜单 checkbox 误捕获）
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
        >
          <button
            type="button"
            className={
              'practice-chrome__btn' + (isToolsOpen ? ' practice-chrome__btn--active' : '')
            }
            onClick={() => setIsToolsOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={isToolsOpen}
            aria-label="页面工具"
            title="页面工具"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 18 18"
              fill="currentColor"
              aria-hidden
            >
              <circle cx="3" cy="9" r="1.6" />
              <circle cx="9" cy="9" r="1.6" />
              <circle cx="15" cy="9" r="1.6" />
            </svg>
          </button>
          {isToolsOpen && (
            <div
              className="practice-chrome__menu"
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="practice-chrome__menu-header">页面工具</div>
              <button
                type="button"
                className="practice-chrome__menu-item"
                onClick={closeToolsAndAlert('设置功能待实现')}
                role="menuitem"
              >
                设置
              </button>
              <button
                type="button"
                className="practice-chrome__menu-item"
                onClick={closeToolsAndAlert('主题切换待实现')}
                role="menuitem"
              >
                主题
              </button>
              <button
                type="button"
                className="practice-chrome__menu-item"
                onClick={closeToolsAndAlert('功能引导待实现')}
                role="menuitem"
              >
                功能引导
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .practice-chrome {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 36px;
          padding: 0 var(--space-5);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.78);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          z-index: 50;
          font-family: var(--font-body);
        }
        /* .practice-chrome__brand / __brand-mark / __brand-name → globals.css
           (next/link doesn't pick up styled-jsx scoped class on its inner <a>).
           Same root cause as __login. */
        .practice-chrome__right {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }
        /* .practice-chrome__login → moved to globals.css (next/link doesn't
           pick up styled-jsx scoped class on its inner <a>). */
        .practice-chrome__avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: var(--radius-circle);
          background: var(--label-primary);
          color: var(--surface);
          font-size: 13px;
          font-weight: var(--type-body-emphasis-weight);
          text-decoration: none;
          transition: opacity var(--duration-fast) var(--ease-standard),
                      transform var(--duration-fast) var(--ease-standard);
        }
        .practice-chrome__avatar:hover {
          opacity: 0.85;
          transform: translateY(-1px);
        }
        .practice-chrome__logout {
          background: transparent;
          border: 0;
          padding: 0 var(--space-2);
          height: 28px;
          cursor: pointer;
          color: var(--label-tertiary);
          font-size: var(--type-caption);
          font-family: inherit;
          border-radius: var(--radius-sm);
          transition: color var(--duration-fast) var(--ease-standard),
                      background var(--duration-fast) var(--ease-standard);
        }
        .practice-chrome__logout:hover {
          color: var(--label-primary);
          background: var(--surface-secondary);
        }
        .practice-chrome__tools {
          position: relative;
        }
        .practice-chrome__btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--label-tertiary);
          cursor: pointer;
          transition: background-color var(--duration-fast) var(--ease-standard),
                      color var(--duration-fast) var(--ease-standard);
        }
        .practice-chrome__btn:hover {
          background: var(--surface-secondary);
          color: var(--label-primary);
        }
        .practice-chrome__btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(28, 28, 28, 0.18);
        }
        .practice-chrome__btn--active {
          background: var(--surface-secondary);
          color: var(--label-primary);
        }
        .practice-chrome__menu {
          position: absolute;
          top: calc(100% + var(--space-1));
          right: 0;
          min-width: 180px;
          padding: var(--space-1);
          background: var(--surface-elevated);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-md);
          display: flex;
          flex-direction: column;
          gap: 2px;
          animation: chrome-menu-in var(--duration-fast) var(--ease-standard);
          z-index: 60;
        }
        @keyframes chrome-menu-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .practice-chrome__menu-header {
          padding: var(--space-2) var(--space-3) var(--space-1);
          font-size: var(--type-caption);
          font-weight: 500;
          color: var(--label-tertiary);
          letter-spacing: 0.02em;
        }
        .practice-chrome__menu-item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
          min-height: 32px;
          padding: 0 var(--space-3);
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--label-secondary);
          font-family: inherit;
          font-size: 14px;
          font-weight: var(--type-body-weight);
          text-align: left;
          cursor: pointer;
          transition: background-color var(--duration-fast) var(--ease-standard);
        }
        .practice-chrome__menu-item:hover {
          background: var(--surface-secondary);
          color: var(--label-primary);
        }
        .practice-chrome__menu-item:focus-visible {
          outline: none;
          background: var(--surface-secondary);
          box-shadow: 0 0 0 2px rgba(28, 28, 28, 0.18);
        }
        /* .practice-chrome__brand-name responsive rule → globals.css
           (paired with the other brand rules). */
      `}</style>
    </div>
  );
}
