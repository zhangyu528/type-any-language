'use client';

import { useCallback, type ReactElement } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import Aurora from '@/components/Aurora';
import AnimatedContent from '@/components/AnimatedContent';
import { useTheme } from '../components/ThemeProvider';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import ScenariosSection from './ScenariosSection';
import LibStrip from './LibStrip';
import DataBento from './DataBento';
import FinalCTA from './FinalCTA';
import styles from './index.module.css';

/**
 * Aurora background colors per theme. Light: full mint/babyblue palette
 * to match the landing hero (no contrast against the page's #F2F8FE bg).
 * Dark: deeper navy anchors + mint highlights so the Aurora stays
 * luminous against the dark page bg without becoming mud.
 */
const AURORA_BY_THEME = {
  light: ['#8FCBF0', '#BFE5F5', '#7DC0FF'] as const,
  dark: ['#7DC0FF', '#A8D0FF', '#042C53'] as const,
};

interface LandingPageProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  onPickLib: (libId: string) => void;
}

export default function LandingPage({
  libs,
  onPickLib,
}: LandingPageProps): ReactElement {
  const firstLib = libs[0];
  const { theme } = useTheme();
  const handleStart = useCallback(() => {
    if (firstLib) onPickLib(firstLib.id);
  }, [firstLib, onPickLib]);

  // Aurora colorStops switch with theme — see AURORA_BY_THEME comment
  // above for the rationale behind each palette.
  const auroraColors = AURORA_BY_THEME[theme === 'dark' ? 'dark' : 'light'];

  return (
    <div className={styles.root} data-babyblue>
      {/* Aurora background — fixed, behind all content. Switches
         colorStops per theme so the flow stays luminous against
         both babyblue (light) and deep-navy (dark) page backgrounds. */}
      <Aurora colorStops={[...auroraColors]} amplitude={1.2} blend={0.6} />

      <div className={styles.content}>
        <Hero
          libs={libs}
          translationProgress={{}}
          onPickLib={onPickLib}
        />

        {/* SECTION 1: 读完一句如何记住 — 3 步拆解 */}
        <HowItWorks />

        {/* SECTION 2: 4 个真实场景 — 营销访客直接"试一下" */}
        <ScenariosSection libs={libs} onPickLib={onPickLib} />

        {/* SECTION 3: 词库选择 — 真实 VocabularyLib[] 卡(DecryptedText + SpecularButton) */}
        <LibStrip libs={libs} onPickLib={onPickLib} />

        {/* SECTION 4: 数据 — 4 横排无装饰 AnimatedCounter */}
        <DataBento libs={libs} />

        {/* 收尾 CTA bar:DecryptedText 标题 + 单金属 SpecularButton「开始读」 */}
        <FinalCTA onStart={handleStart} />

        <AnimatedContent distance={16} delay={0 / 1000} direction="vertical" className={styles.footerWrap}>
          <footer className={styles.footer} aria-label="页脚">
            <div className={styles.footerBrand}>
              <span className={styles.footerBrandName}>Type Any Language</span>
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
            </div>

            <div className={styles.footerMeta}>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>适用场景</span>
                <p className={styles.metaText}>
                  语言学习者 · 每天读完一句,就是你的。
                </p>
              </div>
              <div className={styles.metaBlock}>
                <span className={styles.metaLabel}>转化路径</span>
                <p className={styles.metaPath}>
                  <span className={styles.metaPathStep}>读一句</span>
                  <span className={styles.metaPathArrow}>→</span>
                  <span className={styles.metaPathStep}>写出来</span>
                  <span className={styles.metaPathArrow}>→</span>
                  <span className={styles.metaPathStep}>错改对</span>
                  <span className={styles.metaPathArrow}>→</span>
                  <span className={styles.metaPathStep}>记住</span>
                </p>
              </div>
            </div>

            <span className={styles.footerYear}>© 2026</span>
          </footer>
        </AnimatedContent>
      </div>
    </div>
  );
}