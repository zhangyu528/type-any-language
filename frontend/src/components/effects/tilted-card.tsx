'use client';

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { motion, useMotionValue, useSpring, type SpringOptions } from 'motion/react';
import styles from './tilted-card.module.css';

/**
 * TiltedCard — drop-in port of https://reactbits.dev/components/tilted-card
 *
 * Adaptations vs. the upstream source:
 *   - Replaces `imageSrc` with `children` so it can wrap any node (not just
 *     a single image). The hero demo card needs to tilt around its existing
 *     TypefallDemo contents.
 *   - Drops the mobile warning banner (it would have been a visible string
 *     on a marketing page) and the optional caption tooltip (we don't have
 *     a use case for it).
 *   - Adds `disableOnMobile` to disable the tilt+scale effect entirely on
 *     touch devices (where mousemove doesn't fire and the visual is just
 *     jarring layout shift on every tap).
 *   - Default rotateAmplitude dropped from 14° to 8° — landing context is
 *     calm; 14° looked like the card was falling over.
 */

interface TiltedCardProps {
  children: ReactNode;
  className?: string;
  /** Pixel/percent height of the wrapper (default: '300px') */
  containerHeight?: CSSProperties['height'];
  /** Pixel/percent width of the wrapper (default: '100%') */
  containerWidth?: CSSProperties['width'];
  /** Scale factor on hover (default: 1 = no scale). 1.05-1.1 is gentle. */
  scaleOnHover?: number;
  /** Max degrees of tilt on either axis (default: 8). */
  rotateAmplitude?: number;
  /** Disable on touch / mobile (default: true). */
  disableOnMobile?: boolean;
}

const SPRING: SpringOptions = {
  damping: 30,
  stiffness: 100,
  mass: 2,
};

export default function TiltedCard({
  children,
  className = '',
  containerHeight = '300px',
  containerWidth = '100%',
  scaleOnHover = 1,
  rotateAmplitude = 8,
  disableOnMobile = true,
}: TiltedCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useMotionValue(0), SPRING);
  const rotateY = useSpring(useMotionValue(0), SPRING);
  const scale = useSpring(1, SPRING);
  const [isTouch, setIsTouch] = useState(false);

  // Detect coarse pointer (touch-only) once at mount. The query isn't
  // expected to change mid-session, but listen for changes anyway in case
  // the user attaches/detaches a mouse.
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setIsTouch(mq.matches);
    const onChange = () => setIsTouch(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const tiltDisabled = disableOnMobile && isTouch;

  const handleMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tiltDisabled) return;
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    rotateX.set((offsetY / (rect.height / 2)) * -rotateAmplitude);
    rotateY.set((offsetX / (rect.width / 2)) * rotateAmplitude);
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
  };
  const handleEnter = () => {
    if (tiltDisabled) return;
    scale.set(scaleOnHover);
  };
  const handleLeave = () => {
    if (tiltDisabled) return;
    scale.set(1);
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <div
      ref={ref}
      className={`${styles.root} ${className}`}
      style={{ height: containerHeight, width: containerWidth }}
      onMouseMove={handleMouse}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      data-tilt-disabled={tiltDisabled || undefined}
    >
      <motion.div
        className={styles.tiltLayer}
        style={{ rotateX, rotateY, scale }}
      >
        {children}
      </motion.div>
    </div>
  );
}