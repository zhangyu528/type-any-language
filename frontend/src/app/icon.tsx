/**
 * Favicon — a static, server-rendered SVG icon for /favicon.ico.
 *
 * Next 14 App Router picks up `app/icon.{ico,jpg,jpeg,png,svg}` as
 * the favicon and emits `<link rel="icon">` automatically. We render
 * an SVG (smaller payload than PNG, and inlineable) that mirrors
 * the BrandMark dot matrix: a 3×3 grid where the centre dot is
 * full-opacity and corners fade out radially — the "fingertip
 * print" metaphor.
 *
 * Why not reuse `landing/BrandMark.tsx`:
 *   - It's a client component (`'use client'`) — Next metadata icons
 *     must be rendered server-side.
 *   - It uses `var(--ds-action-deep)` and CSS custom properties for
 *     fill, which don't resolve inside the favicon (the browser
 *     fetches the icon outside any page context, no CSS variables).
 *     We hard-code the colour here instead.
 *   - Keeping a static SVG avoids runtime React work on every favicon
 *     request.
 *
 * Colour choice:
 *   - Centre dot uses the coral action hue (`#C2410C`) — same role
 *     as `--ds-action-deep` in the light theme, matching what
 *     BrandMark renders on the hero. Single static colour across
 *     light/dark mode is fine for a 32px glyph.
 *
 * Size: 32×32 viewBox, browser scales to whatever the OS tab strip
 * needs (typically 16-32px). 32 keeps the dots crisp at retina.
 */

export const size = { width: 32, height: 32 };
export const contentType = 'image/svg+xml';

const CENTER = '#C2410C';
const NEIGHBOR = '#9A3412';
const CORNER = '#78716C';

export default function Icon() {
  // 3×3 matrix on a 32×32 canvas. Cell = 10, gap = 2 → dot r = 4.
  const cell = 10;
  const r = 4;
  const offset = 1; // 1px outer padding so corners don't kiss the edge

  const dots: Array<{ cx: number; cy: number; fill: string; op: number }> = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const isCenter = row === 1 && col === 1;
      const isCorner = row === 0 || row === 2 || col === 0 || col === 2;
      dots.push({
        cx: offset + col * cell + cell / 2,
        cy: offset + row * cell + cell / 2,
        fill: isCenter ? CENTER : isCorner ? CORNER : NEIGHBOR,
        op: isCenter ? 1 : isCorner ? 0.45 : 0.75,
      });
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  ${dots
    .map(
      (d) =>
        `<circle cx="${d.cx}" cy="${d.cy}" r="${r}" fill="${d.fill}" opacity="${d.op}"/>`
    )
    .join('\n  ')}
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}