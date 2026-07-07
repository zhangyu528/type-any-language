'use client';

/**
 * Top bar — brand + auth controls.
 *
 * Three states:
 *   - loading: render nothing (avoids flicker / "登录" briefly showing
 *              while /api/auth/me is in flight)
 *   - anonymous: brand on the left, 登录 / 注册 on the right
 *   - signed in: brand on the left, display_name + 历史 / 登出 on the right
 *
 * Apple HIG style: neutral surfaces, subtle separators, no shadows.
 * The only brand accent is the enso on the practice page (untouched).
 */
import Link from 'next/link';
import { useAuth } from '../lib/auth';

export function Header() {
  const { user, loading, logout } = useAuth();

  if (loading) return null;

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <Link href="/">练习</Link>
      </div>

      <nav className="app-header__nav">
        {user ? (
          <>
            <span className="app-header__user" aria-label="current user">
              {user.display_name}
            </span>
            <Link href="/history">历史</Link>
            <button
              type="button"
              className="app-header__btn"
              onClick={() => {
                void logout();
              }}
            >
              登出
            </button>
          </>
        ) : (
          <>
            <Link href="/login">登录</Link>
            <Link href="/signup">注册</Link>
          </>
        )}
      </nav>

      <style jsx>{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: var(--space-3) var(--space-5);
          background: var(--surface);
          border-bottom: 1px solid var(--separator);
        }
        .app-header__brand a {
          color: var(--label-primary);
          text-decoration: none;
          font-size: var(--type-body-emphasis);
          font-weight: var(--type-body-emphasis-weight);
        }
        .app-header__nav {
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }
        .app-header__nav :global(a) {
          color: var(--label-secondary);
          text-decoration: none;
          font-size: var(--type-body);
        }
        .app-header__nav :global(a:hover) {
          color: var(--label-primary);
        }
        .app-header__user {
          color: var(--label-primary);
          font-size: var(--type-body);
          font-weight: var(--type-body-emphasis-weight);
        }
        .app-header__btn {
          background: transparent;
          border: 0;
          padding: 0;
          cursor: pointer;
          color: var(--label-secondary);
          font-size: var(--type-body);
          font-family: inherit;
        }
        .app-header__btn:hover {
          color: var(--label-primary);
        }
      `}</style>
    </header>
  );
}