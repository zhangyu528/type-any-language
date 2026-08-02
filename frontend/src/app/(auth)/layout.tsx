/**
 * (auth) route group layout — TAL Mint 气泡卡 + 单词流背景。
 *
 * 设计意图:auth 是"进入私密空间"的仪式,但视觉语言与全站一致
 * (TAL Mint 设计系统)。背景是漂移的英→中单词对(产品语义的
 * 第一眼识别),卡片是标准 BubbleCard 加大圆角。
 *
 * Back-to-home affordance: the brand mark at the top of the
 * card is a Link to `/`. Replaces the chrome's "home" link, which
 * would otherwise sit in the top-left.
 *
 * Implementation note: we use a single <style> tag (NOT styled-jsx)
 * because (1) styled-jsx hashes don't reach <Link>'s inner <a>, and
 * (2) the auth-card / auth-wordstream classes are owned by the page +
 * layout and don't need component-scoped isolation.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      {/* Word stream — slow-drifting English words in the background.
          First-glance product recognition: a user sees "fast / wild /
          care / bold..." drifting behind the glass card and instantly
          knows this is a vocabulary app. The aurora blobs are gone
          (kept the comment for posterity); the words do the same job
          of adding "depth" plus semantic product identity.

          Opacity is intentionally low (0.06-0.10) so the glass card
          always wins the focus hierarchy. We pick a curated mix of
          beginner + intermediate + advanced words — not random from
          the lib (random might surface obscene or weird words). */}
      <div className="auth-wordstream" aria-hidden="true">
        {/* 4 EN→ZH pairs. Each pair is a leader-follower unit:
            the EN word uses the same drift keyframe as before; the ZH
            word uses the same keyframe but with animation-delay +0.6s
            relative to its leader — it visibly trails behind in the
            drift, which reads as "the meaning follows the word".

            Hover any EN word → its paired ZH translation fades in
            next to it (handled in CSS via .auth-word-pair:hover
            .auth-word-pair__zh-hover). The hover position is fixed
            (top/right) rather than following the drift, so the two
            words don't visually disconnect while both are moving. */}
        <div className="auth-word-pair" style={{ left: '5%',  top: '12%' }} data-pair="1">
          <span className="auth-word-pair__leader">fast</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">快</span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '12%', top: '22%' }} data-pair="2">
          <span className="auth-word-pair__leader">discovery</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">发现<span className="auth-word-pair__zh-secondary-inline">，探索</span></span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '70%', top: '8%'  }} data-pair="3">
          <span className="auth-word-pair__leader">wander</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">漫游<span className="auth-word-pair__zh-secondary-inline">，走神</span></span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '82%', top: '78%' }} data-pair="4">
          <span className="auth-word-pair__leader">eloquent</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">善辩<span className="auth-word-pair__zh-secondary-inline">，动人</span></span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '32%', top: '86%' }} data-pair="5">
          <span className="auth-word-pair__leader">courage</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">勇气</span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '12%', top: '58%' }} data-pair="6">
          <span className="auth-word-pair__leader">brief</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">简短<span className="auth-word-pair__zh-secondary-inline">，摘要</span></span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '85%', top: '48%' }} data-pair="7">
          <span className="auth-word-pair__leader">sharp</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">锋利<span className="auth-word-pair__zh-secondary-inline">，敏锐</span></span>
          </span>
        </div>
        <div className="auth-word-pair" style={{ left: '78%', top: '86%' }} data-pair="8">
          <span className="auth-word-pair__leader">pause</span>
          <span className="auth-word-pair__zh-hover">
            <span className="auth-word-pair__zh-primary">暂停<span className="auth-word-pair__zh-secondary-inline">，犹豫</span></span>
          </span>
        </div>
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
          /* 100dvh accounts for mobile browser chrome (URL bar) so the
             card stays centered as the bar collapses on scroll. Falls
             back to 100vh on browsers that don't support dvh. */
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6) var(--space-4);
          overflow: hidden;
          background: var(--ds-bg);
        }
        .auth-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 380px;
          padding: var(--space-6) var(--space-6);
          background: var(--ds-surface);
          border: 0.5px solid var(--ds-border);
          border-radius: var(--radius-xl);
          box-shadow: var(--elev-1);
          /* Entrance: card scales up from 0.94 (centered, no translate).
             Scale reads as "the card opens up" — distinct from the
             "the page is shaking" feel that any translateY/Y on the
             card gives. 500ms is slow enough to feel cinematic without
             dragging. */
          animation: auth-card-rise 500ms var(--ease-out) both;
        }
        .auth-card__brand {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          margin: 0 auto var(--space-5);
          padding: var(--space-1) var(--space-2);
          color: var(--ds-ink);
          text-decoration: none;
          font-size: var(--text-body);
          font-weight: var(--weight-medium);
          letter-spacing: -0.01em;
          border-radius: var(--radius-sm);
          transition: background var(--dur-fast) var(--ease-out);
        }
        .auth-card__brand:hover {
          background: var(--ds-tint);
        }
        .auth-card__brand:focus-visible {
          outline: 2px solid var(--ds-focus);
          outline-offset: 4px;
        }
        .auth-card__brand-mark {
          font-size: 26px;
          color: var(--ds-action-deep);
          line-height: 1;
          transition: transform var(--dur-fast) var(--ease-spring);
        }
        .auth-card__brand:hover .auth-card__brand-mark {
          transform: scale(1.08);
        }
        .auth-card__brand-name {
          font-size: var(--text-body);
          font-weight: var(--weight-medium);
          color: var(--ds-ink);
        }

        /* Title char-level fade — each <span class="auth-title__char">
           inside the h1 gets a 50ms-staggered fade + Y rise via inline
           style with animationDelay set per character. */
        .auth-title {
          display: block;
          font-size: var(--text-h1);
          font-weight: var(--weight-medium);
          line-height: var(--text-h1-lh);
          color: var(--ds-ink);
          margin-bottom: var(--space-6);
          text-align: center;
        }
        .auth-title__char {
          display: inline-block;
          opacity: 0;
          /* Each char rises 8px from below with a 120ms stagger
             between chars (4 chars × 120ms = 480ms cascade, each
             char animates over 380ms). Total: 860ms — slow, cinematic
             "welcome" reveal. translateY(8px) is small enough to
             read as "settling into place" rather than "the card
             bounced". */
          animation: auth-char-rise 380ms var(--ease-out) both;
        }
        @keyframes auth-char-rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes auth-card-rise {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes auth-field-rise {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        /* aurora background blobs drift slowly to give the page ambient
           depth. NOT entrance motion — these are infinite loops that
           the user reads as a calm color wash, not "the page is
           shaking". Three blobs at 16-20s loops with 4-10s phase
           offsets so they don't pulse in sync. */
        /* Word pair unit — EN word leads, ZH word trails +0.6s behind
           in the same drift. Hover the EN word → ZH translation
           fades in at a fixed offset (does NOT follow the drift
           so the two words don't visually disconnect). The pair
           is positioned absolutely as one unit so leader and
           follower drift together. */
        .auth-word-pair {
          position: absolute;
          display: inline-flex;
          align-items: baseline;
          gap: 12px;
          pointer-events: auto;
        }
        .auth-word-pair__leader {
          font-family: var(--font-mono);
          font-size: clamp(20px, 2.4vw, 36px);
          font-weight: 500;
          color: var(--ds-ink);
          opacity: 0.14;
          white-space: nowrap;
          cursor: default;
          /* Two animations: drift (large position loop, ~28s) +
             breathe (subtle letter-spacing pulse, 7s). Different
             periods prevent sync; both run infinite. Combined
             motion reads as "alive" rather than "static". */
          animation: auth-word-drift 28s ease-in-out infinite,
                     auth-word-breathe 7s ease-in-out infinite;
          transition: opacity 400ms var(--ease-out),
                      transform 600ms var(--ease-out);
        }
        .auth-word-pair__zh-hover {
          font-family: var(--font-sans);
          font-size: clamp(16px, 1.6vw, 24px);
          font-weight: 400;
          color: var(--ds-ink-soft);
          opacity: 0;
          white-space: nowrap;
          /* Position absolutely to the LEFT of the leader so hover
             reveal never overflows the right viewport edge (some
             pairs sit at left:82-85% and their zh translation
             would otherwise push past the screen). Right edge
             of the auth-shell is the failure mode for right-
             anchored pairs; left-of-leader is safe everywhere. */
          position: absolute;
          right: 100%;
          margin-right: 12px;
          transform: translateX(6px);
          transition: opacity 400ms var(--ease-out),
                      transform 400ms var(--ease-out);
        }
        /* Inline secondary meaning — sits inside the primary span,
           prefixed by a Chinese comma. Same weight + size as the
           primary so the two meanings read as a flat list of
           translations ("锋利，敏锐"), not as primary/secondary
           hierarchy. The Chinese comma provides enough visual
           separation on its own.

           IMPORTANT: no opacity here. CSS opacity is multiplicative
           through nested ancestors — setting opacity:0.65 on this
           inner span would multiply with the parent .__zh-hover's
           0.65 (rendering secondary at 0.42 vs primary's 0.65).
           Inheriting the parent's opacity gives both equal visual
           weight. */
        .auth-word-pair__zh-secondary-inline {
          font-weight: 400;
          font-size: 1em;
        }
        /* Per-pair phase offsets — pair-as-a-unit drifts together.
           Leader starts at phase 0; follower trails by 0.6s (positive
           delay → starts later → stays behind in the loop). Durations
           are now 24-32s (down from 72-90s) so motion is visibly
           perceivable on first glance; combined with the breathe
           animation on .__leader this reads as a living background. */
        .auth-word-pair[data-pair="1"] .auth-word-pair__leader { animation-duration: 28s, 7.0s; animation-delay:   0s, 0s; }
        .auth-word-pair[data-pair="1"] .auth-word-pair__zh-hover { animation-duration: 28s; animation-delay:   0.6s; }
        .auth-word-pair[data-pair="2"] .auth-word-pair__leader { animation-duration: 32s, 7.4s; animation-delay:  -4s, -1.2s; }
        .auth-word-pair[data-pair="2"] .auth-word-pair__zh-hover { animation-duration: 32s; animation-delay:  -3.4s; }
        .auth-word-pair[data-pair="3"] .auth-word-pair__leader { animation-duration: 26s, 7.8s; animation-delay:  -9s, -2.4s; }
        .auth-word-pair[data-pair="3"] .auth-word-pair__zh-hover { animation-duration: 26s; animation-delay:  -8.4s; }
        .auth-word-pair[data-pair="4"] .auth-word-pair__leader { animation-duration: 30s, 7.2s; animation-delay: -14s, -3.6s; }
        .auth-word-pair[data-pair="4"] .auth-word-pair__zh-hover { animation-duration: 30s; animation-delay: -13.4s; }
        .auth-word-pair[data-pair="5"] .auth-word-pair__leader { animation-duration: 24s, 7.6s; animation-delay:  -2s, -4.8s; }
        .auth-word-pair[data-pair="5"] .auth-word-pair__zh-hover { animation-duration: 24s; animation-delay:  -1.4s; }
        .auth-word-pair[data-pair="6"] .auth-word-pair__leader { animation-duration: 29s, 7.3s; animation-delay: -18s, -0.6s; }
        .auth-word-pair[data-pair="6"] .auth-word-pair__zh-hover { animation-duration: 29s; animation-delay: -17.4s; }
        .auth-word-pair[data-pair="7"] .auth-word-pair__leader { animation-duration: 27s, 7.9s; animation-delay:  -6s, -2.0s; }
        .auth-word-pair[data-pair="7"] .auth-word-pair__zh-hover { animation-duration: 27s; animation-delay:  -5.4s; }
        .auth-word-pair[data-pair="8"] .auth-word-pair__leader { animation-duration: 31s, 7.5s; animation-delay: -22s, -5.2s; }
        .auth-word-pair[data-pair="8"] .auth-word-pair__zh-hover { animation-duration: 31s; animation-delay: -21.4s; }
        /* Hover the pair → leader brightens, ZH fades in & slides
           into place. The hover area covers the whole pair unit
           (the EN word is the trigger; ZH is the reveal).

           F (hover-near): the whole pair nudges 4px toward the
           cursor's reading direction — reads as the word leaning
           toward the user, not just "getting brighter". Implemented
           with a small additional transform on the pair wrapper. */
        .auth-word-pair:hover {
          transform: translateX(4px);
        }
        .auth-word-pair:hover .auth-word-pair__leader { opacity: 0.22; }
        .auth-word-pair:hover .auth-word-pair__zh-hover {
          opacity: 0.65;
          transform: translateX(0);
        }
        /* Primary and secondary inherit the parent's hover opacity (0.65)
           equally — both meanings read as a flat list of translations.
           Don't set opacity on .__zh-secondary-inline here: opacity is
           multiplicative through nesting, so this would dim secondary
           to 0.65 × 0.65 = 0.42 vs primary's 0.65. */
        @keyframes auth-word-drift {
          0%, 100% { transform: translate(0, 0); }
          25%      { transform: translate(3vw, -3vh); }
          50%      { transform: translate(-2vw, 4vh); }
          75%      { transform: translate(2vw, 2vh); }
        }
        /* Breathe — gentle scale loop layered on top of drift.
           Implemented as a separate animation on the same element
           (CSS combines them via the multi-animation list). Period
           7s is intentionally distinct from drift period so the
           two animations never sync (no mechanical pulse). */
        @keyframes auth-word-breathe {
          0%, 100% { letter-spacing: 0.02em; }
          50%      { letter-spacing: 0.08em; }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-card { animation: none !important; opacity: 1; transform: none; }
          .auth-title__char { animation: none !important; opacity: 1; transform: none; }
          .auth-word-pair__leader,
          .auth-word-pair__zh-hover { animation: none !important; transform: none; }
        }
      ` }} />
    </main>
  );
}
