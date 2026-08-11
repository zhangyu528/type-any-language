'use client';

/**
 * BlurText — drop-in port of https://reactbits.dev/text-animations/blur-text
 *
 * Each "segment" (word by default) animates from `filter: blur(10px)` + `y: ±50px`
 * to `filter: blur(0)` + `y: 0` with an intermediate blur(5px) waypoint. Animates
 * once when the element enters the viewport (intersection observer).
 *
 * Adaptations vs. the upstream source:
 *   - Defaults tuned for TAL design tokens (direction 'top', word-based stagger,
 *     60ms per-word delay — much tighter than the upstream 200ms which felt
 *     too slow for our H1 copy)
 *   - Reduced-motion: short-circuit the IO and skip the stagger so the title
 *     renders in its final state immediately (no JS animation queued)
 *   - ClassName passthrough so the parent keeps full typography control
 *   - Optional `as` prop ('p' | 'h1' | 'h2' | 'h3') for semantic headings
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { motion } from 'motion/react';

type Direction = 'top' | 'bottom';

export interface BlurTextProps {
  text?: string;
  /** Per-segment stagger in milliseconds */
  delay?: number;
  className?: string;
  /** Split by 'words' (default) or 'characters' */
  animateBy?: 'words' | 'characters';
  direction?: Direction;
  /** IntersectionObserver threshold that triggers the animation */
  threshold?: number;
  rootMargin?: string;
  /** Override the initial keyframe snapshot */
  animationFrom?: Record<string, number | string>;
  /** Override the final keyframe stops (defaults to blur(5px) → blur(0px)) */
  animationTo?: Array<Record<string, number | string>>;
  /** Custom easing */
  easing?: (t: number) => number;
  onAnimationComplete?: () => void;
  /** Per-segment total duration of the animation in seconds */
  stepDuration?: number;
  /** Container styles (parent controls typography via className) */
  style?: CSSProperties;
  /** Element tag (default 'p'). Useful for headings */
  as?: 'p' | 'h1' | 'h2' | 'h3' | 'span' | 'div';
}

function buildKeyframes(
  from: Record<string, number | string>,
  steps: Array<Record<string, number | string>>
): Record<string, Array<number | string>> {
  const keys = new Set([...Object.keys(from), ...steps.flatMap((s) => Object.keys(s))]);
  const out: Record<string, Array<number | string>> = {};
  keys.forEach((k) => {
    out[k] = [from[k], ...steps.map((s) => s[k])];
  });
  return out;
}

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

const Container: Record<NonNullable<BlurTextProps['as']>, ElementType> = {
  p: motion.p,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  span: motion.span,
  div: motion.div,
};

export default function BlurText({
  text = '',
  delay = 60,
  className = '',
  animateBy = 'words',
  direction = 'top',
  threshold = 0.1,
  rootMargin = '0px',
  animationFrom,
  animationTo,
  easing,
  onAnimationComplete,
  stepDuration = 0.35,
  style,
  as = 'p',
}: BlurTextProps): ReactNode {
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const [inView, setInView] = useState(false);
  const ref = useRef<Element | null>(null);
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced) {
      // Skip the staggered animation entirely; jump to the final state.
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(node);
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, reduced]);

  const defaultFrom = useMemo<Record<string, number | string>>(
    () =>
      direction === 'top'
        ? { filter: 'blur(10px)', opacity: 0, y: -50 }
        : { filter: 'blur(10px)', opacity: 0, y: 50 },
    [direction]
  );

  const defaultTo = useMemo<Array<Record<string, number | string>>>(
    () => [
      { filter: 'blur(5px)', opacity: 0.5, y: direction === 'top' ? 5 : -5 },
      { filter: 'blur(0px)', opacity: 1, y: 0 },
    ],
    [direction]
  );

  const fromSnapshot = animationFrom ?? defaultFrom;
  const toSnapshots = animationTo ?? defaultTo;

  const stepCount = toSnapshots.length + 1;
  const totalDuration = stepDuration * (stepCount - 1);
  const times = Array.from({ length: stepCount }, (_, i) =>
    stepCount === 1 ? 0 : i / (stepCount - 1)
  );

  const ContainerTag = Container[as];

  return (
    <ContainerTag
      ref={ref}
      className={className}
      style={{ display: 'flex', flexWrap: 'wrap', ...style }}
    >
      {elements.map((segment, index) => {
        const animateKeyframes = buildKeyframes(fromSnapshot, toSnapshots);
        const spanTransition: {
          duration: number;
          times: number[];
          delay: number;
          ease?: (t: number) => number;
        } = {
          duration: totalDuration,
          times,
          delay: (index * delay) / 1000,
        };
        if (easing) spanTransition.ease = easing;

        return (
          <motion.span
            key={index}
            className="inline-block will-change-[transform,filter,opacity]"
            initial={fromSnapshot}
            animate={inView ? animateKeyframes : fromSnapshot}
            transition={spanTransition}
            onAnimationComplete={
              index === elements.length - 1 ? onAnimationComplete : undefined
            }
          >
            {segment === ' ' ? '\u00A0' : segment}
            {animateBy === 'words' && index < elements.length - 1 ? '\u00A0' : ''}
          </motion.span>
        );
      })}
    </ContainerTag>
  );
}