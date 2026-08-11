'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './spotlight-card.module.css';

/**
 * SpotlightCard — drop-in port of https://reactbits.dev/components/spotlight-card
 *
 * A wrapper that paints a soft radial gradient at the cursor position when the
 * user hovers. Pure CSS (CSS variables + radial-gradient); no WebGL, no GSAP.
 *
 * Adaptations vs. upstream:
 *   - Pure CSS via CSS variables (`--spotlight-x`, `--spotlight-y`,
 *     `--spotlight-color`) instead of inline style objects, so React
 *     doesn't re-render on every mousemove (perf-friendly).
 *   - Reduced-motion: spotlight is hidden (no cursor tracking).
 *   - Spotlight overlay is pointer-events: none so it never blocks clicks
 *     on the wrapped children (e.g. a `<button>` inside the card).
 *
 * Usage:
 *   <SpotlightCard spotlightColor="rgba(255,255,255,0.2)">
 *     <your-card-content />
 *   </SpotlightCard>
 */
export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** Color of the radial gradient (any CSS color). Default: white 25%. */
  spotlightColor?: string;
}

export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(255, 255, 255, 0.25)',
}: SpotlightCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const root = rootRef.current;
    if (!root) return;
    // 写 CSS variables 而不是 setState → 不触发 React re-render
    root.style.setProperty('--spotlight-x', `${e.clientX - rect.left}px`);
    root.style.setProperty('--spotlight-y', `${e.clientY - rect.top}px`);
  };

  const handleMouseEnter = () => setHovering(true);
  const handleMouseLeave = () => setHovering(false);

  // spotlightColor 也走 CSS variable,避免每次 mousemove setStyle
  const style = { '--spotlight-color': spotlightColor } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${hovering ? styles.active : ''} ${className}`}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-reduced={reduced ? 'true' : 'false'}
    >
      <div className={styles.overlay} aria-hidden />
      <div className={styles.content}>{children}</div>
    </div>
  );
}