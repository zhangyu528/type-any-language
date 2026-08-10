'use client';

/**
 * BounceCards — port of https://reactbits.dev/components/bounce-cards
 *
 * Upstream renders 5 scattered image cards with random rotations and
 * an elastic scale-up entrance. Hover on a card pushes siblings aside
 * (and flattens the hovered card's rotation).
 *
 * Adapts to our dashboard's grid paradigm:
 *   - `children: ReactNode[]` instead of `images: string[]` so we can
 *     render our existing lib-progress cards, not images
 *   - default `transformStyles` are `['none', ...]` (no rotation /
 *     no offset) so cards sit in their natural grid positions; the
 *     upstream's "scattered gallery" aesthetic doesn't fit a 2-col
 *     dashboard grid
 *   - hover behavior still works: the hovered card's rotation is
 *     cleared (no-op when rotation is 0) and siblings slide aside
 *     along the x-axis
 *
 * Dependencies: gsap (already installed for MagicBento / ChromaGrid).
 */

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import styles from './bounce-cards.module.css';

export interface BounceCardsProps {
  className?: string;
  /** Card content. Order = position. */
  children?: React.ReactNode[];
  /** Width of the container (px or CSS). */
  containerWidth?: number | string;
  /** Height of the container (px or CSS). */
  containerHeight?: number | string;
  /** Seconds before the entrance starts. */
  animationDelay?: number;
  /** Seconds between each card's entrance. */
  animationStagger?: number;
  /** GSAP easing string. Default 'elastic.out(1, 0.8)' for the
   *  signature bounce-back overshoot. */
  easeType?: string;
  /** Per-card initial transform. Use 'none' for a flat grid layout,
   *  or rotate/translate strings for the upstream scattered look. */
  transformStyles?: string[];
  /** When true, hovering a card pushes siblings aside and clears
   *  the hovered card's rotation. */
  enableHover?: boolean;
}

const DEFAULT_TRANSFORMS = [
  'rotate(10deg) translate(-170px)',
  'rotate(5deg) translate(-85px)',
  'rotate(-3deg)',
  'rotate(-10deg) translate(85px)',
  'rotate(2deg) translate(170px)',
];

export default function BounceCards({
  className = '',
  children = [],
  containerWidth = 400,
  containerHeight = 400,
  animationDelay = 0.5,
  animationStagger = 0.06,
  easeType = 'elastic.out(1, 0.8)',
  transformStyles = DEFAULT_TRANSFORMS,
  enableHover = false,
}: BounceCardsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.bounce-card',
        { scale: 0 },
        {
          scale: 1,
          stagger: animationStagger,
          ease: easeType,
          delay: animationDelay,
        },
      );
    }, containerRef);
    return () => ctx.revert();
  }, [animationDelay, animationStagger, easeType, children.length]);

  const getNoRotationTransform = (transformStr: string): string => {
    const hasRotate = /rotate\([\s\S]*?\)/.test(transformStr);
    if (hasRotate) {
      return transformStr.replace(/rotate\([\s\S]*?\)/, 'rotate(0deg)');
    } else if (transformStr === 'none') {
      return 'rotate(0deg)';
    }
    return `${transformStr} rotate(0deg)`;
  };

  const getPushedTransform = (baseTransform: string, offsetX: number): string => {
    const translateRegex = /translate\(([-0-9.]+)px\)/;
    const match = baseTransform.match(translateRegex);
    if (match) {
      const currentX = parseFloat(match[1]);
      const newX = currentX + offsetX;
      return baseTransform.replace(translateRegex, `translate(${newX}px)`);
    }
    return baseTransform === 'none'
      ? `translate(${offsetX}px)`
      : `${baseTransform} translate(${offsetX}px)`;
  };

  const pushSiblings = (hoveredIdx: number) => {
    if (!enableHover || !containerRef.current) return;
    const selector = gsap.utils.selector(containerRef);

    children.forEach((_, i) => {
      const el = selector(`.bounce-card-${i}`);
      gsap.killTweensOf(el);

      const baseTransform = transformStyles[i] || 'none';
      if (i === hoveredIdx) {
        const noRotation = getNoRotationTransform(baseTransform);
        gsap.to(el, {
          transform: noRotation,
          duration: 0.4,
          ease: 'back.out(1.4)',
          overwrite: 'auto',
        });
      } else {
        // For our dashboard's grid layout the siblings sit on either
        // side, so the push direction depends on column. Without a
        // layout-aware axis, default to "push outward from hovered":
        // left cards push further left, right cards push further right.
        const offsetX = i < hoveredIdx ? -48 : 48;
        const pushedTransform = getPushedTransform(baseTransform, offsetX);
        const distance = Math.abs(hoveredIdx - i);
        const delay = distance * 0.05;
        gsap.to(el, {
          transform: pushedTransform,
          duration: 0.4,
          ease: 'back.out(1.4)',
          delay,
          overwrite: 'auto',
        });
      }
    });
  };

  const resetSiblings = () => {
    if (!enableHover || !containerRef.current) return;
    const selector = gsap.utils.selector(containerRef);

    children.forEach((_, i) => {
      const el = selector(`.bounce-card-${i}`);
      gsap.killTweensOf(el);
      const baseTransform = transformStyles[i] || 'none';
      gsap.to(el, {
        transform: baseTransform,
        duration: 0.4,
        ease: 'back.out(1.4)',
        overwrite: 'auto',
      });
    });
  };

  const widthStyle = typeof containerWidth === 'number' ? `${containerWidth}px` : containerWidth;
  const heightStyle = typeof containerHeight === 'number' ? `${containerHeight}px` : containerHeight;

  return (
    <div
      className={`${styles.container} ${className}`}
      ref={containerRef}
      style={{ width: widthStyle, height: heightStyle }}
    >
      {children.map((node, idx) => (
        <div
          key={idx}
          className={`bounce-card bounce-card-${idx} ${styles.card}`}
          style={{ transform: transformStyles[idx] || 'none' }}
          onMouseEnter={() => pushSiblings(idx)}
          onMouseLeave={resetSiblings}
        >
          {node}
        </div>
      ))}
    </div>
  );
}