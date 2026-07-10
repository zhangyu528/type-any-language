/**
 * (auth) route group layout — glassmorphism card on aurora gradient.
 *
 * PracticePage (the `/` route) is NOT inside this group — it stays
 * public and renders its own chrome (PracticeChrome). The (auth)
 * group gives /login and /signup a distinct visual context from the
 * practice flow.
 *
 * Design intent: auth is a distinct mental state from "casual practice"
 * — it deserves a visual context shift. Aurora gradient + frosted
 * glass card signals "you're entering a private space" without being
 * heavy or corporate. Sits in deliberate contrast to the neutral
 * Apple-HIG rest of the app.
 *
 * Back-to-home affordance: the enso brand mark at the top of the
 * card is a Link to `/`. Replaces the chrome's "home" link, which
 * would otherwise sit in the top-left.
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
          /* Two problems with the previous setup that made motion
             invisible:
             1. 56px blur absorbed the translation — softer edges mean
                the color gradient is more uniform, so 80px of motion
                barely shows.
             2. The pastel colors (#FFB7C5 / #C9B6F2 / #FFD49B) were
                only marginally more saturated than the background
                gradient, so even visible motion registered as
                "color slightly shifted" rather than "blob moved".
             40px blur + deeper colors fix both. */
          filter: blur(40px);
          opacity: 0.75;
          will-change: transform;
        }
        .auth-aurora__blob--a {
          top: -10%;
          left: -15%;
          width: 42vw;
          height: 42vw;
          background: #FF6B9D;
          animation: auth-blob-drift-a 18s ease-in-out infinite;
        }
        .auth-aurora__blob--b {
          bottom: -10%;
          right: -15%;
          width: 40vw;
          height: 40vw;
          background: #8B6BF0;
          animation: auth-blob-drift-b 20s ease-in-out infinite -6s;
        }
        .auth-aurora__blob--c {
          /* Re-centered: this blob now sits behind the auth card
             itself, so the frosted glass (rgba white 55% + backdrop
             blur 28px) shows the color shifting underneath as the
             blob drifts. The motion lands in the user's visual focus
             area, not in the corners they're not looking at. */
          top: 25%;
          left: 30%;
          width: 44vw;
          height: 44vw;
          background: #FFB347;
          animation: auth-blob-drift-c 16s ease-in-out infinite -10s;
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
          /* One-time entrance: fade + 12px rise. 'both' fill so the
             initial state (opacity 0) is applied before the animation
             starts — avoids a flash of fully-rendered card. */
          animation: auth-card-rise 600ms var(--ease-emphasized) both;
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

        /* Title char-level fade — each <span class="auth-title__char">
           inside the h1 gets a 50ms-staggered fade + Y rise via inline
           style with animationDelay set per character. 700ms after the
           card starts, all chars are in place. */
        .auth-title {
          display: block;
        }
        .auth-title__char {
          display: inline-block;
          opacity: 0;
          transform: translateY(6px);
          animation: auth-char-rise 500ms var(--ease-emphasized) both;
        }
        @keyframes auth-char-rise {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes auth-card-rise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes auth-field-rise {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes auth-blob-drift-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25%      { transform: translate(12vw, -8vh) scale(1.22); }
          50%      { transform: translate(6vw, 10vh) scale(0.85); }
          75%      { transform: translate(-10vw, 6vh) scale(1.12); }
        }
        @keyframes auth-blob-drift-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          20%      { transform: translate(-10vw, 7vh) scale(1.2); }
          45%      { transform: translate(12vw, 8vh) scale(0.8); }
          70%      { transform: translate(5vw, -10vh) scale(1.15); }
          90%      { transform: translate(-6vw, 4vh) scale(0.92); }
        }
        @keyframes auth-blob-drift-c {
          /* The "center" blob — motion is the focal point. Wider
             translation range so the color visibly shifts position
             behind the card glass. */
          0%, 100% { transform: translate(0, 0) scale(1); }
          25%      { transform: translate(15vw, -8vh) scale(1.25); }
          50%      { transform: translate(-10vw, 10vh) scale(0.78); }
          75%      { transform: translate(8vw, -6vh) scale(1.18); }
        }
      ` }} />
    </main>
  );
}