'use client';

import { useEffect, useState, type CSSProperties, type ElementType } from 'react';

/**
 * ShinyText — drop-in port of https://reactbits.dev/text-animations/shiny-text
 *
 * A moving light band sweeps across the text via `background-clip: text`.
 *
 * Adaptations vs. the upstream source:
 *   - Upstream is tuned for DARK backgrounds (dim base + white sweep). This
 *     port themes via two tokens so it reads on BOTH light and dark:
 *       --shiny-base  : resting text color (visible on the surface)
 *       --shiny-shine : bright sweep band; must contrast with --shiny-base
 *     Defaults fall back to DS tokens; callers / theme blocks override them
 *     per theme (e.g. dimmer base on dark so the white band pops).
 *   - Reduced-motion: animation disabled; the gradient rests on the base
 *     color, so the text stays fully legible with no motion.
 */

export interface ShinyTextProps {
  text: string;
  /** Seconds per full sweep loop */
  speed?: number;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p' | 'div';
  /** Resting text color — must be visible on the background.
   *  Defaults to the --shiny-base theme token (falls back to DS action). */
  baseColor?: string;
  /** Bright sweep band color. Defaults to --shiny-shine. */
  shineColor?: string;
}

const TagMap: Record<NonNullable<ShinyTextProps['as']>, ElementType> = {
  span: 'span',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  p: 'p',
  div: 'div',
};

export default function ShinyText({
  text,
  speed = 4,
  className = '',
  as = 'span',
  baseColor = 'var(--shiny-base, var(--ds-action-deep))',
  shineColor = 'var(--shiny-shine, #EAF7FF)',
}: ShinyTextProps) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const Tag = TagMap[as];
  // Mostly base color, with a brighter band sitting in the middle of the
  // gradient. background-size: 220% + animated background-position sweeps it.
  // Stops 25% / 75% give a wide transition region so the shine peak (solid
  // 45% → 55%) holds for ~10% of the gradient — visible "glint" not a thin
  // highlight. Keep the band a light TINT of the base hue (not pure white)
  // so it never matches a light background — pure white on a white page
  // just "disappears".
  const background = `linear-gradient(110deg, ${baseColor} 0%, ${baseColor} 25%, ${shineColor} 45%, ${shineColor} 55%, ${baseColor} 75%, ${baseColor} 100%)`;

  const style: CSSProperties = {
    backgroundImage: background,
    backgroundSize: '220% 100%',
    backgroundRepeat: 'no-repeat',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
    animation: reduced ? undefined : `shiny-sweep ${speed}s linear infinite`,
  };

  return (
    <Tag className={className} style={style}>
      {text}
    </Tag>
  );
}
