'use client';

import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import styles from './variable-proximity.module.css';

/**
 * VariableProximity — drop-in port of https://reactbits.dev/text-animations/variable-proximity
 *
 * Interpolation of OpenType font-variation axes (e.g. wght, opsz) based on
 * distance to the cursor. Works with Fraunces (this project's display
 * font), which exposes `opsz` and `wght` axes natively.
 *
 * Adaptations vs. the upstream source:
 *   - `fromFontVariationSettings` / `toFontVariationSettings` collapsed into
 *     a single `from` / `to` record (`{ wght: 400, opsz: 14 }`) so callers
 *     don't have to format CSS strings.
 *   - Accepts an optional `as` prop (default "span") with a small whitelist
 *     since the upstream uses `forwardRef<HTMLSpanElement, ...>`.
 *   - The raf loop is gated by `prefers-reduced-motion` (skip updates,
 *     settle to `from` settings) and by `IntersectionObserver` (skip when
 *     off-screen).
 */

type Falloff = 'linear' | 'exponential' | 'gaussian';

interface AxisValue {
  axis: string;
  fromValue: number;
  toValue: number;
}

export interface VariableProximityProps {
  label: string;
  /** Map of axis → numeric value at "rest" (cursor outside radius). */
  from: Record<string, number>;
  /** Map of axis → numeric value at "peak" (cursor directly on the letter). */
  to: Record<string, number>;
  /** Container to track mouse position relative to. Defaults to `document`. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Distance in pixels within which the proximity effect activates. */
  radius?: number;
  /** How the influence falls off with distance. Default: 'linear'. */
  falloff?: Falloff;
  /** Element tag — only 'span' / 'p' / 'h1'..'h4' / 'div'. Default: 'span'. */
  as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3' | 'h4';
  className?: string;
  style?: CSSProperties;
}

function useAnimationFrame(callback: () => void) {
  useEffect(() => {
    let id: number;
    const loop = () => {
      callback();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [callback]);
}

function useMousePosition(containerRef?: RefObject<HTMLElement | null>) {
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const update = (x: number, y: number) => {
      if (containerRef?.current) {
        const rect = containerRef.current.getBoundingClientRect();
        positionRef.current = { x: x - rect.left, y: y - rect.top };
      } else {
        positionRef.current = { x, y };
      }
    };
    const onMouse = (e: MouseEvent) => update(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) update(t.clientX, t.clientY);
    };
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('touchmove', onTouch);
    return () => {
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('touchmove', onTouch);
    };
  }, [containerRef]);

  return positionRef;
}

const VARIATION_AXES = ['opsz', 'wght', 'wdth', 'slnt', 'ital'] as const;

function settingsToCSS(map: Record<string, number>): string {
  // Per the W3C spec for `font-variation-settings`, the axis tag MUST be a
  // <string> — i.e. wrapped in double quotes. Browsers (Chromium in
  // particular) reject unquoted axis names like `wght 500` even though
  // `wght` looks like a valid identifier. Always quote.
  return Object.entries(map)
    .map(([axis, value]) => `"${axis}" ${value}`)
    .join(', ');
}

const VariableProximity = forwardRef<HTMLElement, VariableProximityProps>(
  function VariableProximity(props, ref) {
    const {
      label,
      from,
      to,
      containerRef,
      radius = 80,
      falloff = 'linear',
      as = 'span',
      className = '',
      style,
    } = props;

    const rootRef = useRef<HTMLSpanElement | null>(null);
    const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const lastPosRef = useRef<{ x: number | null; y: number | null }>({
      x: null,
      y: null,
    });
    // Always track the mouse position relative to our own root so letter
    // centers (which we also compute relative to root) line up.
    const mousePositionRef = useMousePosition(rootRef);

    const fromCSS = useMemo(() => settingsToCSS(from), [from]);

    const parsed = useMemo<AxisValue[]>(
      () =>
        VARIATION_AXES.filter((axis) => axis in from || axis in to).map((axis) => ({
          axis,
          fromValue: from[axis] ?? 0,
          toValue: to[axis] ?? (from[axis] ?? 0),
        })),
      [from, to],
    );

    const computeFalloff = (distance: number) => {
      const norm = Math.min(Math.max(1 - distance / radius, 0), 1);
      switch (falloff) {
        case 'exponential':
          return norm * norm;
        case 'gaussian':
          return Math.exp(-((distance / (radius / 2)) ** 2) / 2);
        case 'linear':
        default:
          return norm;
      }
    };

    // IntersectionObserver — skip work when the element isn't visible.
    const isVisibleRef = useRef(true);
    useEffect(() => {
      const node = rootRef.current;
      if (!node || typeof IntersectionObserver === 'undefined') return;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) isVisibleRef.current = entry.isIntersecting;
        },
        { rootMargin: '0px' },
      );
      obs.observe(node);
      return () => obs.disconnect();
    }, []);

    // Reduced-motion: render at rest, never start the RAF.
    const reducedMotion = useRef(false);
    useEffect(() => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion.current = mq.matches;
      const onChange = () => {
        reducedMotion.current = mq.matches;
        // Reset to rest on enable
        if (mq.matches) {
          for (const lr of letterRefs.current) {
            if (lr) lr.style.setProperty('font-variation-settings', fromCSS);
          }
        }
      };
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }, [fromCSS]);

    useAnimationFrame(() => {
      if (!rootRef.current) return;
      if (reducedMotion.current) return;
      if (!isVisibleRef.current) return;
      const { x, y } = mousePositionRef.current;
      if (lastPosRef.current.x === x && lastPosRef.current.y === y) return;
      lastPosRef.current = { x, y };

      const rootRect = rootRef.current.getBoundingClientRect();

      for (let i = 0; i < letterRefs.current.length; i++) {
        const lr = letterRefs.current[i];
        if (!lr) continue;
        const rect = lr.getBoundingClientRect();
        const cx = rect.left + rect.width / 2 - rootRect.left;
        const cy = rect.top + rect.height / 2 - rootRect.top;
        const dx = mousePositionRef.current.x - cx;
        const dy = mousePositionRef.current.y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance >= radius) {
          lr.style.setProperty('font-variation-settings', fromCSS);
          continue;
        }
        const f = computeFalloff(distance);
        const css = parsed
          .map(({ axis, fromValue, toValue }) => {
            const v = fromValue + (toValue - fromValue) * f;
            return `"${axis}" ${v}`;
          })
          .join(', ');
        lr.style.setProperty('font-variation-settings', css);
      }
    });

    const words = label.split(' ');
    let letterIndex = 0;

    const content = (
      <>
        {words.map((word, wi) => (
          <span
            key={wi}
            className={styles.word}
            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
          >
            {word.split('').map((letter) => {
              const idx = letterIndex++;
              return (
                <span
                  key={idx}
                  ref={(el) => {
                    letterRefs.current[idx] = el;
                  }}
                  className={styles.letter}
                  aria-hidden
                >
                  {letter}
                </span>
              );
            })}
            {wi < words.length - 1 ? (
              <span className={styles.spacer} aria-hidden>
                {' '}
              </span>
            ) : null}
          </span>
        ))}
        <span className={styles.srOnly}>{label}</span>
      </>
    );

    const mergedStyle: CSSProperties = {
      ...style,
    };

    // React 18's CSSProperties doesn't include `fontVariationSettings`, so
    // setting it via `style.fontVariationSettings = ...` silently drops the
    // update. Use setProperty directly on the host after mount.
    const setHostStyle = (host: HTMLElement | null) => {
      if (!host) return;
      host.style.setProperty('font-variation-settings', fromCSS);
    };

    const setRef = (node: HTMLElement | null) => {
      rootRef.current = node as HTMLSpanElement | null;
      setHostStyle(node);
      if (typeof ref === 'function') ref(node);
    };

    // Also apply to the host whenever fromCSS changes (so re-renders
    // reflect new axis settings).
    useEffect(() => {
      if (rootRef.current) setHostStyle(rootRef.current);
    }, [fromCSS]);

    const Tag = as;
    // setRef already defined above

    return (
      <Tag
        ref={setRef}
        className={`${styles.root} ${className}`}
        style={mergedStyle}
      >
        {content}
      </Tag>
    );
  },
);

export default VariableProximity;