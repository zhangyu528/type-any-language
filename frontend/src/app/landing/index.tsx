'use client';

import { useCallback, type ReactElement } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import LibShowcase from './LibShowcase';
import FinalCTA from './FinalCTA';
import styles from './index.module.css';

interface LandingPageProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

const SCROLL_OFFSET = 80; // 顶部 nav 留出的偏移

export default function LandingPage({
  libs,
  translationProgress,
  onPickLib,
}: LandingPageProps): ReactElement {
  // 跨段滚动辅助:从 02 / 05 跳到 04 词库
  const jumpToLibs = useCallback(() => {
    if (typeof document === 'undefined') return;
    const target = document.getElementById('lib-showcase');
    if (!target) return;
    const top =
      target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top, behavior: 'smooth' });
  }, []);

  // 收尾 CTA 的"立即开始"——取第一份词库
  const firstLib = libs[0];
  const handleStart = useCallback(() => {
    if (firstLib) onPickLib(firstLib.id);
  }, [firstLib, onPickLib]);

  return (
    <div className={styles.root}>
      <Hero
        libs={libs}
        translationProgress={translationProgress}
        onPickLib={onPickLib}
      />

      <HowItWorks onJumpToLibs={jumpToLibs} />

      <LibShowcase libs={libs} onPickLib={onPickLib} />

      <FinalCTA onStart={handleStart} onJumpToLibs={jumpToLibs} />

      <footer className={styles.footer} aria-label="页脚">
        <span className={styles.footerBrand}>Type Any Language</span>
        <ul className={styles.footerLinks}>
          <li>
            <a
              href="https://github.com/zhangyu528/type-any-language"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </li>
          <li>
            <a href="mailto:hi@type-any-language.dev">联系</a>
          </li>
        </ul>
        <span className={styles.footerYear}>© 2026</span>
      </footer>
    </div>
  );
}
