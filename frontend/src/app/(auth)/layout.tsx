/**
 * (auth) route group layout — glassmorphism card on aurora gradient.
 *
 * The route group `(auth)` keeps /login and /signup from inheriting
 * Header (we don't want a "登录" button on the login page itself).
 * Header detects /login|/signup via usePathname and returns null.
 * PracticePage (the `/` route) is NOT inside this group — it remains
 * public and keeps the original Apple-HIG-style layout.
 *
 * Design intent: auth is a distinct mental state from "casual practice"
 * — it deserves a visual context shift. Aurora gradient + frosted
 * glass card signals "you're entering a private space" without being
 * heavy or corporate. Sits in deliberate contrast to the neutral
 * Apple-HIG rest of the app.
 *
 * Back-to-home affordance: the enso brand mark at the top of the
 * card is a Link to `/`. Replaces Header's "练习" link that would
 * otherwise sit in the top-left.
 */
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      {/* Soft floating blobs behind the card — pure decoration, screen-reader
          hidden. Adds the "aurora" motion/depth without being noisy. */}
      <div className="auth-aurora" aria-hidden="true">
        <span className="auth-aurora__blob auth-aurora__blob--a" />
        <span className="auth-aurora__blob auth-aurora__blob--b" />
        <span className="auth-aurora__blob auth-aurora__blob--c" />
      </div>

      <div className="auth-card">
        <Link
          href="/"
          className="auth-card__brand"
          aria-label="返回首页"
          title="返回首页"
        >
          <span className="auth-card__brand-mark">◯</span>
          <span className="auth-card__brand-name">Type Any Language</span>
        </Link>
        {children}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .auth-shell {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6) var(--space-4);
          overflow: hidden;
          background: linear-gradient(
            135deg,
            #F5E8FF 0%,
            #FFE5EC 45%,
            #FFF1E0 100%
          );
        }
        .auth-aurora {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .auth-aurora__blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.55;
          will-change: transform;
        }
        .auth-aurora__blob--a {
          top: -8%;
          left: -10%;
          width: 48vw;
          height: 48vw;
          background: #FFB7C5;
        }
        .auth-aurora__blob--b {
          top: 10%;
          right: -12%;
          width: 44vw;
          height: 44vw;
          background: #C9B6F2;
        }
        .auth-aurora__blob--c {
          bottom: -15%;
          left: 30%;
          width: 50vw;
          height: 50vw;
          background: #FFD49B;
        }
        .auth-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 380px;
          padding: var(--space-7) var(--space-6);
          background: rgba(255, 255, 255, 0.55);
          backdrop-filter: blur(28px) saturate(180%);
          -webkit-backdrop-filter: blur(28px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: var(--radius-lg);
          box-shadow:
            0 12px 48px rgba(80, 40, 120, 0.10),
            0 2px 8px rgba(80, 40, 120, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }
        .auth-card__brand {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          margin: 0 auto var(--space-5);
          padding: var(--space-1) var(--space-2);
          color: var(--label-primary);
          text-decoration: none;
          font-size: var(--type-body);
          font-weight: var(--type-title-3-weight);
          letter-spacing: -0.01em;
          border-radius: var(--radius-sm);
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .auth-card__brand:hover {
          background: rgba(255, 255, 255, 0.45);
        }
        .auth-card__brand:focus-visible {
          outline: 2px solid var(--label-primary);
          outline-offset: 4px;
        }
        .auth-card__brand-mark {
          font-size: 26px;
          color: var(--accent);
          line-height: 1;
          filter: drop-shadow(0 2px 6px rgba(215, 0, 21, 0.18));
          transition: transform var(--duration-fast) var(--ease-standard),
                      filter var(--duration-fast) var(--ease-standard);
        }
        .auth-card__brand:hover .auth-card__brand-mark {
          transform: scale(1.08);
          filter: drop-shadow(0 4px 10px rgba(215, 0, 21, 0.28));
        }
        .auth-card__brand-name {
          font-size: var(--type-body-emphasis);
          font-weight: var(--type-title-3-weight);
          color: var(--label-primary);
        }
        .auth-card h1 {
          font-size: var(--type-title-2);
          font-weight: var(--type-title-2-weight);
          line-height: var(--type-title-2-lh);
          color: var(--label-primary);
          margin-bottom: var(--space-6);
          text-align: center;
        }
      ` }} />
    </main>
  );
}