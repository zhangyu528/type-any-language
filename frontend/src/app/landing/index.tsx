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

export default function LandingPage({
  libs,
  translationProgress,
  onPickLib,
}: LandingPageProps): ReactElement {
  // 跨段滚动辅助:从 02 / 05 跳到 04 词库。
  // scrollIntoView({ block: 'start' }) 会自动 honored <html> 上的
  // scroll-padding-top: 52px,目标顶部落到 header 下方。
  // behavior: 'smooth' 是 JS API,不会被 prefers-reduced-motion 的
  // scroll-behavior: auto !important 覆盖 —— 按钮点击仍然 smooth 是
  // 有意的 UX(reduced-motion 只抑制装饰动画,不影响 CTA 反馈)。
  const jumpToLibs = useCallback(() => {
    if (typeof document === 'undefined') return;
    const target = document.getElementById('lib-showcase');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
