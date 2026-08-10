'use client';

import { useRef, useEffect, type ReactNode } from 'react';
import { gsap } from 'gsap';
import styles from './chroma-grid.module.css';

/**
 * ChromaGrid — drop-in port of https://reactbits.dev/components/chroma-grid
 *
 * Adaptations:
 *   - `image` slot is optional; if absent, the image wrapper renders a
 *     decorative gradient swatch matching `gradient`. This is so the same
 *     component can host profile cards (with avatars) AND vocabulary-lib
 *     cards (no avatar, just a color mark).
 *   - Click handler is per-card `onClick`; `url` fallback to `window.open`
 *     is preserved for backward compatibility.
 *   - All animations disabled when prefers-reduced-motion is on.
 */

export interface ChromaGridItem {
  image?: string;
  title: string;
  subtitle?: string;
  handle?: string;
  borderColor?: string;
  gradient?: string;
  url?: string;
  /** Optional React node (e.g. a number, badge, level chip) shown below the title */
  meta?: ReactNode;
  onClick?: () => void;
}

interface ChromaGridProps {
  items: ChromaGridItem[];
  className?: string;
  radius?: number;
  columns?: number;
  rows?: number;
  damping?: number;
  fadeOut?: number;
  ease?: string;
}

const DEFAULT_GRADIENT = 'linear-gradient(145deg, #1a2a26, #000)';
const DEFAULT_BORDER = 'rgba(255, 255, 255, 0.18)';

function useReducedMotionSafe(): boolean {
  const [reduced, setReduced] = useStateSafe(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return reduced;
}

// Local mini hook wrapper to avoid clashing with React's import shape
import { useState as useStateSafe } from 'react';

export default function ChromaGrid({
  items,
  className = '',
  radius = 300,
  columns = 3,
  rows = 2,
  damping = 0.45,
  fadeOut = 0.6,
  ease = 'power3.out',
}: ChromaGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const setX = useRef<((v: number) => void) | null>(null);
  const setY = useRef<((v: number) => void) | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    if (reduced) return;
    const el = rootRef.current;
    if (!el) return;
    setX.current = gsap.quickSetter(el, '--x', 'px') as (v: number) => void;
    setY.current = gsap.quickSetter(el, '--y', 'px') as (v: number) => void;
    const { width, height } = el.getBoundingClientRect();
    pos.current = { x: width / 2, y: height / 2 };
    setX.current?.(pos.current.x);
    setY.current?.(pos.current.y);
  }, [reduced]);

  const moveTo = (x: number, y: number) => {
    if (reduced) return;
    gsap.to(pos.current, {
      x,
      y,
      duration: damping,
      ease,
      onUpdate: () => {
        setX.current?.(pos.current.x);
        setY.current?.(pos.current.y);
      },
      overwrite: true,
    });
  };

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    moveTo(e.clientX - r.left, e.clientY - r.top);
    gsap.to(fadeRef.current, { opacity: 0, duration: 0.25, overwrite: true });
  };

  const handleLeave = () => {
    if (reduced) return;
    gsap.to(fadeRef.current, { opacity: 1, duration: fadeOut, overwrite: true });
  };

  const handleCardClick = (item: ChromaGridItem) => {
    if (item.onClick) {
      item.onClick();
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCardMove = (e: React.MouseEvent<HTMLElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.grid} ${className}`}
      style={{
        ['--r' as string]: `${radius}px`,
        ['--cols' as string]: String(columns),
        ['--rows' as string]: String(rows),
      }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      {items.map((c, i) => (
        <article
          key={i}
          className={styles.card}
          onMouseMove={handleCardMove}
          onClick={() => handleCardClick(c)}
          style={{
            ['--card-border' as string]: c.borderColor ?? DEFAULT_BORDER,
            ['--card-gradient' as string]: c.gradient ?? DEFAULT_GRADIENT,
            cursor: c.url || c.onClick ? 'pointer' : 'default',
          }}
        >
          <div className={styles.imgWrapper}>
            {c.image ? (
              <img src={c.image} alt={c.title} loading="lazy" />
            ) : (
              <div
                className={styles.imgFallback}
                style={{
                  background: c.gradient ?? DEFAULT_GRADIENT,
                }}
                aria-hidden
              />
            )}
          </div>
          <footer className={styles.info}>
            <h3 className={styles.name}>{c.title}</h3>
            {c.handle ? <span className={styles.handle}>{c.handle}</span> : null}
            <p className={styles.role}>{c.subtitle}</p>
            {c.meta ? <div className={styles.meta}>{c.meta}</div> : null}
          </footer>
        </article>
      ))}
      <div className={styles.overlay} />
      <div ref={fadeRef} className={styles.fade} />
    </div>
  );
}
