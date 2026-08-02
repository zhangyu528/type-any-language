'use client';

/**
 * useCountUp — animate a number from 0 to `to` over `duration` ms.
 *
 * Used by StatsTab's KPI cells so the page reads as "filling up with
 * your numbers" instead of "4 digits snap into existence". Honors
 * prefers-reduced-motion: when set, the hook returns `to` immediately
 * and skips animation entirely.
 *
 * Why ease-out cubic (not spring): the user has been waiting for
 * stats to land since they clicked the avatar — a snappy ease-out
 * reads as "the system computed this fast" rather than "the system
 * is bouncing toward an answer". A spring overshoots the target,
 * which feels wrong on a number that should be exact.
 *
 * Returns `[value, reached]`. `reached` flips true on the frame
 * the count lands on `to` and stays true thereafter — callers use
 * it to fire one-shot effects like the achievement glow.
 *
 * rAF + functional setState — no React re-render storm, no setTimeout
 * drift, no requestAnimationFrame polyfill issues.
 */
import { useEffect, useState } from 'react';

const DEFAULT_DURATION_MS = 320;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useCountUp(
  to: number,
  durationMs: number = DEFAULT_DURATION_MS,
): [number, boolean] {
  const [value, setValue] = useState(0);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    // Reset on target change — if a re-render comes in with a
    // different `to`, we want to count up to the new target and
    // re-fire the reached flag.
    setReached(false);
    setValue(0);

    // Reduced motion → jump straight to target. Also: if `to` is 0
    // there's nothing to count up to.
    if (prefersReducedMotion() || to <= 0) {
      setValue(to);
      setReached(true);
      return;
    }

    let rafId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * to));
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Land exactly on the target (Math.round can drift by 1)
        // and flip the reached flag so the caller can fire a
        // one-shot effect.
        setValue(to);
        setReached(true);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [to, durationMs]);

  return [value, reached];
}