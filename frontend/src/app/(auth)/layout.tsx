/**
 * (auth) route group layout — centered card for login/signup.
 *
 * The route group `(auth)` keeps /login and /signup from inheriting
 * Header (we don't want a "登录" button on the login page itself).
 * PracticePage (the `/` route) is NOT inside this group — it remains
 * public and keeps the original layout.
 *
 * Apple HIG aesthetic: neutral background, single subtle-bordered
 * card, generous vertical whitespace.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__brand" aria-hidden="true">
          ◯
        </div>
        {children}
      </div>

      <style>{`
        .auth-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6) var(--space-4);
          background: var(--surface);
        }
        .auth-card {
          width: 100%;
          max-width: 360px;
          padding: var(--space-7) var(--space-6);
          background: var(--surface-elevated);
          border: 1px solid var(--separator-opaque);
          border-radius: var(--radius-md);
        }
        .auth-card__brand {
          font-size: 32px;
          color: var(--accent);
          text-align: center;
          margin-bottom: var(--space-5);
          line-height: 1;
        }
        .auth-card h1 {
          font-size: var(--type-title-3);
          font-weight: var(--type-title-3-weight);
          line-height: var(--type-title-3-lh);
          color: var(--label-primary);
          margin-bottom: var(--space-5);
          text-align: center;
        }
      `}</style>
    </main>
  );
}