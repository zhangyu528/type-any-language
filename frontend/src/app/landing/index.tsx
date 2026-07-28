'use client';

import { VocabularyLib, TranslationProgress } from '../api';
import Hero from './Hero';

interface LandingPageProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

/**
 * LandingPage — content-driven home page.
 *
 * Sections, top to bottom:
 *   1. Hero (full viewport, char-level fadeUp + live TypefallDemo + single CTA)
 *   2. Footer (minimal links)
 *
 * The hero is the entire page content; the user enters via the
 * header's 登录 / 注册 pills or the hero's start button. Daily-plan
 * / lib-market / daily-word sections used to live here but were
 * retired in favour of a single, focused hero — the rest of the
 * page is `/history` (signed-in users) or whatever the auth flow
 * bounces them into.
 */
export default function LandingPage({
  libs,
  translationProgress,
  onPickLib,
}: LandingPageProps) {
  return (
    <div className="landing">
      <Hero
        libs={libs}
        translationProgress={translationProgress}
        onPickLib={onPickLib}
      />

      <footer className="landing-footer" aria-label="页脚">
        <span className="landing-footer__brand">
          <span className="landing-footer__mark" aria-hidden>◯</span>
          Type Any Language · 听一句，写一句
        </span>
        <ul className="landing-footer__links">
          <li>
            <a
              href="https://github.com/"
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
        <span>© 2026</span>
      </footer>
    </div>
  );
}