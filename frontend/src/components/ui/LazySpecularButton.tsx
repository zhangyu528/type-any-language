'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { SpecularButtonProps } from '@/components/SpecularButton';
import styles from './LazySpecularButton.module.css';

type Props = SpecularButtonProps & {
  /** Shown while the WebGL button chunk is loading (holds layout). */
  placeholder: ReactNode;
};

/**
 * Lazy SpecularButton — defers the `ogl` WebGL shader chunk off the
 * first-paint path and fades the real button in once it arrives
 * (instead of hard-cutting it in). Same code-splitting as
 * next/dynamic, plus a controlled opacity fade on mount.
 */
export default function LazySpecularButton({ placeholder, className, ...rest }: Props) {
  const [Comp, setComp] = useState<ComponentType<SpecularButtonProps> | null>(null);

  useEffect(() => {
    let active = true;
    void import('@/components/SpecularButton').then((m) => {
      if (active) setComp(() => m.default);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!Comp) return <>{placeholder}</>;

  const merged = [className, styles.fadeIn].filter(Boolean).join(' ');
  return <Comp {...rest} className={merged} />;
}
