'use client';

import { VocabularyLib, TranslationProgress } from '../api';
import Hero from './Hero';
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
}: LandingPageProps) {
  return (
    <div className={styles.root}>
      <Hero
        libs={libs}
        translationProgress={translationProgress}
        onPickLib={onPickLib}
      />

      <footer className={styles.footer} aria-label="页脚">
        <span className={styles.footerBrand}>
          Type Any Language
        </span>
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