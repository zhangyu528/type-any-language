'use client';

/**
 * Beams — drop-in port of https://reactbits.dev/backgrounds/beams
 *
 * Diagonal light beams that sweep across a WebGL canvas. Each beam
 * is a soft Gaussian perpendicular to its direction; the direction
 * itself rotates slowly via Perlin-noise offset, giving a "light
 * beams through a dusty room" feel.
 *
 * Adapted vs upstream:
 *   - Same ogl import (Renderer / Program / Mesh / Triangle) as
 *     our <Threads> — keeps the WebGL pipeline consistent.
 *   - `color` accepts hex string parsed to RGB triple (Threads-style)
 *   - `beamCount` clamped 1..12 (upstream's hard max is 10, but
 *     smaller login-area canvases look better with 4-6)
 *   - `prefers-reduced-motion` → render a single static frame
 *     (no RAF update) so the background doesn't "live" but is
 *     still present.
 *
 * Use in the right card's empty area as a background that fills
 * the visual void without competing with the form content.
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import { Renderer, Program, Mesh, Triangle, Color } from 'ogl';

export interface BeamsProps {
  /** RGB triple (0..1). Default = [1, 1, 1] (white). */
  color?: [number, number, number];
  /** Number of beams. Default 5. Clamped 1..12. */
  beamCount?: number;
  /** Per-beam amplitude perpendicular to its direction. Default 8. */
  amplitude?: number;
  /** Time multiplier. Default 0.15. */
  speed?: number;
  /** Beam half-width in screen units. Default 0.05. */
  beamWidth?: number;
  className?: string;
  style?: CSSProperties;
}

function parseColor(input: string | [number, number, number]): [number, number, number] {
  if (Array.isArray(input)) return input;
  const hex = input.trim().replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16) / 255,
      parseInt(hex[1] + hex[1], 16) / 255,
      parseInt(hex[2] + hex[2], 16) / 255,
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const m = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return [1, 1, 1];
}

const vertexShader = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 uColor;
uniform float uBeamCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uBeamWidth;

/* Cheap 2D hash for pseudo-random per-beam offset. */
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  /* Aspect-corrected coords: x stretched by aspect so beams
     run at consistent visual angle regardless of canvas shape. */
  vec2 p = (uv - 0.5) * vec2(iResolution.x / iResolution.y, 1.0) * 2.0;

  vec3 col = vec3(0.0);

  /* Up to 12 beams (clamped via uBeamCount at draw time). */
  for (float i = 0.0; i < 12.0; i += 1.0) {
    if (i >= uBeamCount) break;
    float fi = i / max(uBeamCount, 1.0);
    float t = iTime * uSpeed + fi * 12.566;  /* fi * 4π */

    /* Per-beam diagonal angle — each beam has its own fixed
       direction but offset by a slowly-rotating phase so the
       cluster of beams feels alive, not a static grid. */
    float angle = fi * 3.14 + 0.5;
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 perp = vec2(-dir.y, dir.x);

    /* Beam position along its perpendicular: a sin offset
       makes the beam gently sway in/out of the canvas. */
    float sway = sin(t * 0.7 + fi * 4.0) * 0.4 * uAmplitude;
    float along = dot(p, dir) - sway;

    /* Perpendicular distance from the beam center line. */
    float pd = abs(dot(p, perp));

    /* Soft Gaussian perpendicular profile — `beamWidth` controls
       how thick the beam appears. */
    float beam = exp(-pow(pd / uBeamWidth, 2.0));

    /* Brighten the center of the beam along its length — gives
       a "light shaft" gradient rather than a uniform line. */
    float lengthShape = exp(-pow(along * 0.4, 2.0)) * 0.5 + 0.5;

    /* Edge falloff so beams fade out at the canvas border. */
    float edge = smoothstep(1.0, 0.6, length(uv - 0.5) * 2.0);

    col += uColor * beam * lengthShape * edge;
  }

  /* Add subtle film grain to break up banding. */
  col += vec3(hash21(uv * 1000.0 + iTime) * 0.02);

  gl_FragColor = vec4(col, 1.0);
}
`;

export default function Beams({
  color = [1, 1, 1],
  beamCount = 5,
  amplitude = 8,
  speed = 0.15,
  beamWidth = 0.05,
  className,
  style,
}: BeamsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useReducedMotionSafe();
  const [mounted, setMounted] = useMountedSafe();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !mounted) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new Renderer({
      dpr,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.display = 'block';

    const [w, h] = [container.offsetWidth || 1, container.offsetHeight || 1];
    renderer.setSize(w, h);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: [w * dpr, h * dpr] },
        uColor: { value: new Color(...color) },
        uBeamCount: { value: Math.max(1, Math.min(12, beamCount)) },
        uSpeed: { value: speed },
        uAmplitude: { value: amplitude },
        uBeamWidth: { value: beamWidth },
      },
      transparent: true,
    });
    const mesh = new Mesh(gl, { geometry, program });
    gl.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });

    let raf = 0;
    const start = performance.now();
    const update = (t: number) => {
      raf = requestAnimationFrame(update);
      const elapsed = (t - start) / 1000;
      program.uniforms.iTime.value = reduced ? 0 : elapsed;
      renderer.render({ scene: mesh, camera: null });
    };
    raf = requestAnimationFrame(update);

    // Observe size changes so we can re-init the WebGL viewport
    const ro = new ResizeObserver(() => {
      const nw = container.offsetWidth || 1;
      const nh = container.offsetHeight || 1;
      renderer.setSize(nw, nh);
      const u = program.uniforms as { iResolution: { value: [number, number] } };
      u.iResolution.value = [nw * dpr, nh * dpr];
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [color, beamCount, amplitude, speed, beamWidth, mounted, reduced]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}
    />
  );
}

// Tiny inline hooks to avoid pulling more files
import { useEffect as _useEffect, useState as _useState } from 'react';
function useMountedSafe() {
  const [m, setM] = _useState(false);
  _useEffect(() => { setM(true); }, []);
  return m;
}
function useReducedMotionSafe() {
  const [r, setR] = _useState(false);
  _useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(mq.matches);
    const onChange = () => setR(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return r;
}
