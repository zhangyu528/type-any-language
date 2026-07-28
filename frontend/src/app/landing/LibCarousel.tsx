'use client';

import { useEffect, useRef, useState } from 'react';
import { VocabularyLib } from '../api';

interface LibCarouselProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

/**
 * LibCarousel — large horizontal scroll-snap carousel at the top of
 * the lib market section. Each card is a 360×220 cover with the
 * lib's name + level + description + a "开始练习" button.
 *
 * Mechanics:
 *   - Native `scroll-snap-x mandatory` on the track (no JS animation).
 *   - Wheel events with vertical delta get translated to horizontal
 *     scroll when the cursor is over the track — natural on trackpads.
 *   - Touch/drag is free with native scroll.
 *   - Left/right edge fade is done with `mask-image` on the track
 *     container, not on each card. JS-free.
 *
 * Carousel picks: `pickCarouselLibs()` from data.ts — the highest
 * level + 2 mid-tier. The full grid below shows everything.
 */
export default function LibCarousel({ libs, onPickLib }: LibCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Convert vertical wheel to horizontal scroll inside the track.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only redirect when the dominant axis is vertical and the user
      // is actually over the track. Horizontal scrolls (trackpads) pass
      // through unchanged.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, top: 0, behavior: 'auto' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="lib-carousel" aria-label="精选词库">
      <div ref={trackRef} className="lib-carousel__track">
        {libs.map((lib) => (
          <CarouselCard key={lib.id} lib={lib} onPick={() => onPickLib(lib.id)} />
        ))}
      </div>
    </div>
  );
}

function CarouselCard({
  lib,
  onPick,
}: {
  lib: VocabularyLib;
  onPick: () => void;
}) {
  // Per-card cover tint by level — cool→warm gradient ramp.
  const tintClass = tintForLevel(lib.level);
  return (
    <article className={`carousel-card carousel-card--${tintClass}`}>
      <div className="carousel-card__cover" aria-hidden>
        <span className="carousel-card__level">{lib.level}</span>
      </div>
      <div className="carousel-card__body">
        <h3 className="carousel-card__name">{lib.name}</h3>
        {lib.description && (
          <p className="carousel-card__desc">{lib.description}</p>
        )}
        <p className="carousel-card__meta">
          {lib.word_count.toLocaleString()} 词
        </p>
        <button
          type="button"
          className="carousel-card__btn"
          onClick={onPick}
        >
          开始练习 →
        </button>
      </div>
    </article>
  );
}

/* level → tint class. The actual color comes from CSS so the palette
   stays in one place; the class is just a hook. */
function tintForLevel(level: string): string {
  const l = level.toLowerCase();
  if (l === 'a1' || l === 'a2') return 'tint-cool';
  if (l === 'b1' || l === 'b2') return 'tint-mist';
  if (l === 'c1' || l === 'c2') return 'tint-warm';
  return 'tint-mist';
}
