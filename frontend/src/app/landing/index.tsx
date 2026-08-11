'use client';

import { useCallback, type ReactElement } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { AuroraBackground, SpecularButton } from '@/components/effects';
import { BABY_BLUE_CURTAINS } from '@/components/effects/baby-blue-curtains';
import Hero from './Hero';
import ScenariosSection from './ScenariosSection';
import LibStrip from './LibStrip';
import DataBento from './DataBento';
import FinalCTA from './FinalCTA';
import styles from './index.module.css';

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
  const handleStart = useCallback(() => {
    if (firstLib) onPickLib(firstLib.id);
  }, [firstLib, onPickLib]);

  return (
    <div className={styles.root} data-babyblue>
      {/* Aurora background — fixed, behind all content */}
      <AuroraBackground className="fixed inset-0 z-0" curtains={BABY_BLUE_CURTAINS} />

      <div className={styles.content}>
        <Hero
          libs={libs}
          translationProgress={{}}
          onPickLib={onPickLib}
        />

        {/* SECTION 2: 4 个真实场景 — 营销访客直接"试一下" */}
        <ScenariosSection libs={libs} onPickLib={onPickLib} />

        {/* SECTION 3: 词库条 — 暖琥珀背景,横排 */}
        <LibStrip libs={libs} onPickLib={onPickLib} />

        {/* SECTION 4: 4 数据 — 词库数/句数/上手时间/价格(派生自 libs) */}
        <DataBento libs={libs} />

        {/* 黑色 CTA bar:左侧"选个场景试试 →",右侧琥珀按钮 */}
        <FinalCTA onStart={handleStart} />

        <footer className={styles.footer} aria-label="页脚">
          <div className={styles.footerBrand}>
            <span className={styles.footerBrandName}>Type Any Language</span>
            <ul className={styles.footerLinks}>
              <li>
                {/*
                  外链用 SpecularButton + window.open 模拟 — react-bits 里没有
                  anchor 形态的按钮,这是为了把所有 UI 控件统一在 react-bits
                  之内的折中方案。语义上仍是 button(用户期待"打开新页"的副
                  作用由 onClick 承担),可访问性通过 aria-label 标注。
                */}
                <SpecularButton
                  size="sm"
                  onClick={() =>
                    window.open(
                      'https://github.com/zhangyu528/type-any-language',
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                  tint="#8FCBF0"
                  tintOpacity={1}
                  baseColor="#5BA8D8"
                  lineColor="#FFFFFF"
                  textColor="#0C2C53"
                  blur={6}
                  intensity={1}
                  followMouse
                  proximity={300}
                  className={styles.footerLink}
                  aria-label="GitHub 仓库(在新标签页打开)"
                >
                  GitHub ↗
                </SpecularButton>
              </li>
              <li>
                <SpecularButton
                  size="sm"
                  onClick={() => {
                    window.location.href = 'mailto:hi@type-any-language.dev';
                  }}
                  tint="#8FCBF0"
                  tintOpacity={1}
                  baseColor="#5BA8D8"
                  lineColor="#FFFFFF"
                  textColor="#0C2C53"
                  blur={6}
                  intensity={1}
                  followMouse
                  proximity={300}
                  className={styles.footerLink}
                  aria-label="联系我们(打开邮件客户端)"
                >
                  联系 ✉
                </SpecularButton>
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
      </div>
    </div>
  );
}