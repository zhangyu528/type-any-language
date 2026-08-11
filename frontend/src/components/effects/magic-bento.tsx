'use client';

import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import { gsap } from 'gsap';
import styles from './magic-bento.module.css';

/**
 * MagicBento — drop-in port of https://reactbits.dev/components/magic-bento
 *
 * Adaptations vs. the upstream source:
 *   - `cardData` is now `cards` prop (data-driven)
 *   - Each card has a `icon` slot (we render whatever node the parent puts in)
 *   - Per-card cursor tracking is owned by `BentoCard` (independent of the
 *     optional `GlobalSpotlight`), so `enableSpotlight={false}` still gives
 *     you the cursor-following border ring on each card
 *   - `enableStars` defaults to false (the dots-into-orbit particle effect is
 *     loud; in this landing context the spotlight + border-glow are enough)
 *   - All animations disabled when prefers-reduced-motion is on
 */

export interface MagicBentoCard {
  /** Tint applied as `color` (the bg of the card body) */
  color?: string;
  /** Top-left header label (e.g. "01" / "听") */
  label?: string;
  /** Card title (used when no `children` is provided) */
  title?: string;
  /** Body copy under the title (used when no `children` is provided) */
  description?: string;
  /**
   * Custom body content. When provided, REPLACES the default
   * (label + title + description) layout — use this for non-text
   * bodies (AnimatedCounter, charts, custom React trees). The
   * card's header still shows `label` + `icon` automatically.
   */
  children?: ReactNode;
  /** Optional decoration (small SVG, character, etc.) shown above the title */
  icon?: ReactNode;
  /** Optional click handler */
  onClick?: () => void;
  /** Optional hover-in / hover-out callbacks (parent can drive child demos) */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

interface MagicBentoProps {
  cards: MagicBentoCard[];
  className?: string;
  /** "132, 0, 255" — comma-separated RGB so the radial-gradient can mix alpha */
  glowColor?: string;
  spotlightRadius?: number;
  enableBorderGlow?: boolean;
  enableSpotlight?: boolean;
  enableStars?: boolean;
  enableTilt?: boolean;
  enableMagnetism?: boolean;
  clickEffect?: boolean;
}

const MOBILE_BREAKPOINT = 768;

function useReducedMotionSafe(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function useMobileDetection(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

/* ------------------------------------------------------------------ */
/*  BentoCard — drives the per-card border-ring glow                    */
/* ------------------------------------------------------------------ */

/**
 * Each card owns its own cursor tracking so the `::after` ring follows
 * the cursor whenever the cursor is over the card. This is independent
 * of the optional GlobalSpotlight — `enableSpotlight={false}` therefore
 * still gives you the per-card hover ring.
 */

interface BentoCardProps {
  card: MagicBentoCard;
  baseClassName: string;
  inner: ReactNode;
  cardStyle: React.CSSProperties;
  enableBorderGlow: boolean;
  spotlightRadius: number;
  disableAnimations: boolean;
}

function BentoCard({
  card,
  baseClassName,
  inner,
  cardStyle,
  enableBorderGlow,
  spotlightRadius,
  disableAnimations,
}: BentoCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { onMouseEnter, onMouseLeave, onClick } = card;

  // Stash the latest callbacks in refs so the listener effect can run
  // once at mount instead of being re-bound every parent render (which
  // would otherwise strip the active class as soon as the parent's
  // hover handler triggers a re-render).
  const onEnterRef = useRef(onMouseEnter);
  const onLeaveRef = useRef(onMouseLeave);
  onEnterRef.current = onMouseEnter;
  onLeaveRef.current = onMouseLeave;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enableBorderGlow || disableAnimations) return;

    // Hold the latest mousemove so the ring snaps to the cursor on enter
    const lastMoveEventRef: { current: MouseEvent | null } = { current: null };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const rx = ((e.clientX - rect.left) / rect.width) * 100;
      const ry = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--glow-x', `${rx}%`);
      el.style.setProperty('--glow-y', `${ry}%`);
      el.style.setProperty('--glow-radius', `${spotlightRadius}px`);
    };
    const onMoveCapture = (e: MouseEvent) => {
      lastMoveEventRef.current = e;
      onMove(e);
    };
    const onEnter = () => {
      // Capture the very latest cursor pos before revealing the ring
      // (otherwise the ring would briefly flash at the previous spot)
      const rect = el.getBoundingClientRect();
      const lastMove = lastMoveEventRef.current;
      if (lastMove) {
        el.style.setProperty(
          '--glow-x',
          `${((lastMove.clientX - rect.left) / rect.width) * 100}%`
        );
        el.style.setProperty(
          '--glow-y',
          `${((lastMove.clientY - rect.top) / rect.height) * 100}%`
        );
      }
      el.classList.add(styles.cardBorderGlowActive);
      onEnterRef.current?.();
    };
    const onLeave = () => {
      el.classList.remove(styles.cardBorderGlowActive);
      onLeaveRef.current?.();
    };

    el.addEventListener('mousemove', onMoveCapture);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMoveCapture);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.classList.remove(styles.cardBorderGlowActive);
    };
  }, [enableBorderGlow, spotlightRadius, disableAnimations]);

  return (
    <div
      ref={ref}
      className={baseClassName}
      style={cardStyle}
      onClick={card.onClick}
      role={card.onClick ? 'button' : undefined}
      tabIndex={card.onClick ? 0 : undefined}
    >
      {inner}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ParticleCard — handles per-card particles + tilt + magnetism       */
/* ------------------------------------------------------------------ */

interface ParticleCardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  disableAnimations: boolean;
  particleCount: number;
  glowColor: string;
  enableTilt: boolean;
  clickEffect: boolean;
  enableMagnetism: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const PARTICLE_COUNT = 12;

const createParticleElement = (x: number, y: number, color: string) => {
  const el = document.createElement('div');
  el.className = 'magic-bento-particle';
  el.style.cssText = `
    position: absolute;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(${color}, 1);
    box-shadow: 0 0 6px rgba(${color}, 0.6);
    pointer-events: none;
    z-index: 100;
    left: ${x}px;
    top: ${y}px;
  `;
  return el;
};

function ParticleCard({
  children,
  className = '',
  style,
  disableAnimations,
  particleCount,
  glowColor,
  enableTilt,
  clickEffect,
  enableMagnetism,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: ParticleCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isHoveredRef = useRef(false);
  const memoizedParticles = useRef<HTMLDivElement[]>([]);
  const particlesInitialized = useRef(false);
  const magnetismAnimationRef = useRef<gsap.core.Tween | null>(null);

  const initializeParticles = useCallback(() => {
    if (particlesInitialized.current || !cardRef.current) return;
    const { width, height } = cardRef.current.getBoundingClientRect();
    memoizedParticles.current = Array.from({ length: particleCount }, () =>
      createParticleElement(Math.random() * width, Math.random() * height, glowColor)
    );
    particlesInitialized.current = true;
  }, [particleCount, glowColor]);

  const clearAllParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    magnetismAnimationRef.current?.kill();

    particlesRef.current.forEach((p) => {
      gsap.to(p, {
        scale: 0,
        opacity: 0,
        duration: 0.3,
        ease: 'back.in(1.7)',
        onComplete: () => p.parentNode?.removeChild(p),
      });
    });
    particlesRef.current = [];
  }, []);

  const animateParticles = useCallback(() => {
    if (!cardRef.current || !isHoveredRef.current) return;
    if (!particlesInitialized.current) initializeParticles();

    memoizedParticles.current.forEach((particle, index) => {
      const id = setTimeout(() => {
        if (!isHoveredRef.current || !cardRef.current) return;
        const clone = particle.cloneNode(true) as HTMLDivElement;
        cardRef.current.appendChild(clone);
        particlesRef.current.push(clone);

        gsap.fromTo(
          clone,
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' }
        );
        gsap.to(clone, {
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
          rotation: Math.random() * 360,
          duration: 2 + Math.random() * 2,
          ease: 'none',
          repeat: -1,
          yoyo: true,
        });
        gsap.to(clone, {
          opacity: 0.3,
          duration: 1.5,
          ease: 'power2.inOut',
          repeat: -1,
          yoyo: true,
        });
      }, index * 100);
      timeoutsRef.current.push(id);
    });
  }, [initializeParticles]);

  useEffect(() => {
    if (disableAnimations || !cardRef.current) return;
    const el = cardRef.current;
    // capture the onClick prop via ref so the listener sees the latest version
    const onClickPropRef: { current: (() => void) | undefined } = { current: onClick };

    const onEnter = () => {
      isHoveredRef.current = true;
      animateParticles();
      onMouseEnter?.();
      if (enableTilt) {
        gsap.to(el, {
          rotateX: 5,
          rotateY: 5,
          duration: 0.3,
          ease: 'power2.out',
          transformPerspective: 1000,
        });
      }
    };
    const onLeave = () => {
      isHoveredRef.current = false;
      clearAllParticles();
      onMouseLeave?.();
      if (enableTilt) {
        gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.3, ease: 'power2.out' });
      }
      if (enableMagnetism) {
        gsap.to(el, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
      }
    };
    const onMove = (e: MouseEvent) => {
      if (!enableTilt && !enableMagnetism) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      if (enableTilt) {
        const rotateX = ((y - cy) / cy) * -10;
        const rotateY = ((x - cx) / cx) * 10;
        gsap.to(el, {
          rotateX,
          rotateY,
          duration: 0.1,
          ease: 'power2.out',
          transformPerspective: 1000,
        });
      }
      if (enableMagnetism) {
        const mx = (x - cx) * 0.05;
        const my = (y - cy) * 0.05;
        gsap.to(el, { x: mx, y: my, duration: 0.3, ease: 'power2.out' });
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (!clickEffect) {
        onClickPropRef.current?.();
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const maxDistance = Math.max(
        Math.hypot(x, y),
        Math.hypot(x - rect.width, y),
        Math.hypot(x, y - rect.height),
        Math.hypot(x - rect.width, y - rect.height)
      );
      const ripple = document.createElement('div');
      ripple.style.cssText = `
        position: absolute;
        width: ${maxDistance * 2}px;
        height: ${maxDistance * 2}px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(${glowColor}, 0.4) 0%, rgba(${glowColor}, 0.2) 30%, transparent 70%);
        left: ${x - maxDistance}px;
        top: ${y - maxDistance}px;
        pointer-events: none;
        z-index: 1000;
      `;
      el.appendChild(ripple);
      gsap.fromTo(
        ripple,
        { scale: 0, opacity: 1 },
        {
          scale: 1,
          opacity: 0,
          duration: 0.8,
          ease: 'power2.out',
          onComplete: () => ripple.remove(),
        }
      );
      onClickPropRef.current?.();
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('click', handleClick);

    return () => {
      isHoveredRef.current = false;
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('click', handleClick);
      clearAllParticles();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateParticles, clearAllParticles, disableAnimations, enableTilt, enableMagnetism, clickEffect, glowColor]);

  return (
    <div
      ref={cardRef}
      className={`${className} ${styles.particleContainer}`}
      style={{ ...style, position: 'relative', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
// (mark: onMouseEnter/onMouseLeave on the wrapper div are intentionally NOT
// passed through — they would fire in addition to the manual listener above
// and double-fire the parent's callback. The custom listener handles it.)

/* ------------------------------------------------------------------ */
/*  GlobalSpotlight — single shared radial that follows the cursor    */
/* ------------------------------------------------------------------ */

function GlobalSpotlight({
  gridRef,
  enabled,
  spotlightRadius,
  glowColor,
}: {
  gridRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  spotlightRadius: number;
  glowColor: string;
}) {
  useEffect(() => {
    if (!enabled || !gridRef.current) return;
    const spotlight = document.createElement('div');
    spotlight.className = 'magic-bento-global-spotlight';
    spotlight.style.cssText = `
      position: fixed;
      width: 800px;
      height: 800px;
      border-radius: 50%;
      pointer-events: none;
      background: radial-gradient(circle,
        rgba(${glowColor}, 0.15) 0%,
        rgba(${glowColor}, 0.08) 15%,
        rgba(${glowColor}, 0.04) 25%,
        rgba(${glowColor}, 0.02) 40%,
        rgba(${glowColor}, 0.01) 65%,
        transparent 70%
      );
      z-index: 200;
      opacity: 0;
      transform: translate(-50%, -50%);
      mix-blend-mode: screen;
    `;
    document.body.appendChild(spotlight);

    const onMove = (e: MouseEvent) => {
      const section = gridRef.current?.closest(`.${styles.bentoSection}`) as HTMLElement | null;
      const rect = section?.getBoundingClientRect();
      const mouseInside = !!(
        rect &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );

      gsap.to(spotlight, { left: e.clientX, top: e.clientY, duration: 0.1, ease: 'power2.out' });
      gsap.to(spotlight, {
        opacity: mouseInside ? 0.8 : 0,
        duration: mouseInside ? 0.2 : 0.5,
        ease: 'power2.out',
      });
    };

    const onLeave = () => {
      gsap.to(spotlight, { opacity: 0, duration: 0.3, ease: 'power2.out' });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      spotlight.remove();
    };
  }, [gridRef, enabled, spotlightRadius, glowColor]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  MagicBento (public)                                               */
/* ------------------------------------------------------------------ */

export default function MagicBento({
  cards,
  className = '',
  glowColor = '34, 201, 151', // mint
  spotlightRadius = 300,
  enableBorderGlow = true,
  enableSpotlight = true,
  enableStars = false,
  enableTilt = false,
  enableMagnetism = false,
  clickEffect = false,
}: MagicBentoProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobileDetection();
  const reduced = useReducedMotionSafe();
  const disableAnimations = isMobile || reduced;

  return (
    <>
      <GlobalSpotlight
        gridRef={gridRef}
        enabled={enableSpotlight && !disableAnimations}
        spotlightRadius={spotlightRadius}
        glowColor={glowColor}
      />
      <div
        ref={gridRef}
        className={`${styles.grid} ${styles.bentoSection} ${className}`}
        style={{ ['--glow-color' as string]: glowColor }}
      >
        {cards.map((card, index) => {
          const baseClassName = `${styles.card} ${styles.cardAutohide} ${
            enableBorderGlow ? styles.cardBorderGlow : ''
          }`;
          // --glow-color is now set on the .grid wrapper instead of each card,
          // so consumers can override it via CSS (e.g. theme-aware via
          // [data-theme=dark]) without specificity-warring the inline style.
          // customStyles merged onto cardStyle so consumers can override
          // aspectRatio / minHeight / gridColumn etc. via inline style.
          const cardStyle: React.CSSProperties = {
            backgroundColor: card.color ?? '#0f1411',
            ...(card.customStyles ?? {}),
          };

          const inner = card.children ? (
            <>
              {card.label || card.icon ? (
                <div className={styles.cardHeader}>
                  {card.label ? <div className={styles.cardLabel}>{card.label}</div> : null}
                  {card.icon ? <div className={styles.cardIcon}>{card.icon}</div> : null}
                </div>
              ) : null}
              <div className={styles.cardContent}>{card.children}</div>
            </>
          ) : (
            <>
              <div className={styles.cardHeader}>
                <div className={styles.cardLabel}>{card.label}</div>
                {card.icon ? <div className={styles.cardIcon}>{card.icon}</div> : null}
              </div>
              <div className={styles.cardContent}>
                <h3 className={styles.cardTitle}>{card.title}</h3>
                <p className={styles.cardDescription}>{card.description}</p>
              </div>
            </>
          );

          return (
            <BentoCard
              key={index}
              card={card}
              baseClassName={baseClassName}
              inner={inner}
              cardStyle={cardStyle}
              enableBorderGlow={enableBorderGlow}
              spotlightRadius={spotlightRadius}
              disableAnimations={disableAnimations}
            />
          );
        })}
      </div>
    </>
  );
}
