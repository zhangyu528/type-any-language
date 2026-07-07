/**
 * (auth) route group layout — glassmorphism card on aurora gradient.
 *
 * The route group `(auth)` keeps /login and /signup from inheriting
 * Header (we don't want a "登录" button on the login page itself).
 * PracticePage (the `/` route) is NOT inside this group — it remains
 * public and keeps the original Apple-HIG-style layout.
 *
 * Design intent: auth is a distinct mental state from "casual practice"
 * — it deserves a visual context shift. Aurora gradient + frosted
 * glass card signals "you're entering a private space" without being
 * heavy or corporate. Sits in deliberate contrast to the neutral
 * Apple-HIG rest of the app.
 */
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
        <div className="auth-card__brand" aria-hidden="true">
          ◯
        </div>
        {children}
      </div>

      <style>{`
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
          font-size: 38px;
          color: var(--accent);
          text-align: center;
          margin-bottom: var(--space-5);
          line-height: 1;
          filter: drop-shadow(0 2px 6px rgba(215, 0, 21, 0.18));
        }
        .auth-card h1 {
          font-size: var(--type-title-2);
          font-weight: var(--type-title-2-weight);
          line-height: var(--type-title-2-lh);
          color: var(--label-primary);
          margin-bottom: var(--space-6);
          text-align: center;
        }
      `}</style>
    </main>
  );
}