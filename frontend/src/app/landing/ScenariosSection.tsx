'use client';

/**
 * ScenariosSection — 重设计 SECTION 2
 *
 * 之前:shadcn MagicBento 硬编码英文 Analytics/Dashboard 演示卡,与
 *   "4 个真实场景" 的中文标题完全脱节(内容 bug)。
 * 现在:用真实的 SCENES 数据渲染 4 张卡片,每张用 reactbits 的
 *   DecryptedText(字符还原,呼应"读出来"签名母题)展示英文句,
 *   配 SpecularButton「试一下」直接 onPickLib 进入练习。
 *
 * reactbits 角色:
 *   - DecryptedText → 每卡英文句(animateOn="view" 滚动入视触发还原)
 *   - SpecularButton → 单金属「试一下」CTA
 *   - AnimatedContent → 4 卡错峰入场(沿用全站节奏)
 */

import { useReducedMotion } from 'motion/react';
import DecryptedText from '@/components/DecryptedText';
import SpecularButton from '@/components/SpecularButton';
import AnimatedContent from '@/components/AnimatedContent';
import { VocabularyLib } from '../api';
import styles from './ScenariosSection.module.css';

interface Scene {
  emoji: string;
  name: string;
  zh: string;
  en: string;
}

const SCENES: Scene[] = [
  { emoji: '☕', name: 'Coffee Shop', zh: '我想点一杯拿铁', en: "I'd like a latte, please." },
  { emoji: '✈️', name: 'Travel', zh: '火车站在哪里?', en: 'Where is the train station?' },
  { emoji: '💼', name: 'Workplace', zh: '我们约个会议吧', en: "Let's schedule a meeting." },
  { emoji: '🎉', name: 'Social', zh: '你好,认识你很高兴', en: 'Nice to meet you, Alex.' },
];

interface ScenariosSectionProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

export default function ScenariosSection({ libs, onPickLib }: ScenariosSectionProps) {
  const reduce = useReducedMotion();
  const firstLib = libs[0];

  const handleTry = () => {
    if (firstLib) onPickLib(firstLib.id);
  };

  return (
    <section id="scenarios" className={styles.root} aria-labelledby="scenarios-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 2 · 4 个真实场景</p>
        <h2 id="scenarios-title" className={styles.title}>
          选一个场景,读一句话。
        </h2>
        <p className={styles.subtitle}>4 个开口场景,从这里读。</p>
      </AnimatedContent>

      <div className={styles.grid}>
        {SCENES.map((scene, i) => (
          <AnimatedContent
            key={scene.name}
            distance={20}
            delay={(80 + i * 90) / 1000}
            direction="vertical"
            className={styles.sceneCard}
          >
            <div className={styles.cardInner}>
              <span className={styles.emoji} aria-hidden="true">
                {scene.emoji}
              </span>
              <h3 className={styles.cardSceneName}>{scene.name}</h3>
              <p className={styles.cardZh}>{scene.zh}</p>
              <div className={styles.enWrap}>
                {reduce ? (
                  <span className={styles.cardQuote}>{scene.en}</span>
                ) : (
                  <DecryptedText
                    text={scene.en}
                    animateOn="view"
                    sequential
                    revealDirection="start"
                    speed={35}
                    maxIterations={6}
                    className={styles.cardQuote}
                  />
                )}
              </div>
              <div className={styles.cardSpacer} />
              {/* 试一下 CTA 走 cta 琥珀(--ds-cta),与全场「开始读」按钮
                  统一转化色语言。baseColor / lineColor / textColor 必须
                  是字面 hex —— SpecularButton 喂给 ogl shader,不解析 var()。
                  #EFA535 = --ds-cta(暗主题琥珀)作 rim 基色,白 shine + 白字。 */}
                            <SpecularButton
                size="sm"
                onClick={handleTry}
                disabled={!firstLib}
                tint="var(--ds-cta)"
                tintOpacity={0.95}
                baseColor="#EFA535"
                lineColor="#FFFFFF"
                textColor="#FFFFFF"
                blur={4}
                followMouse
                proximity={220}
                className={styles.practiceBtn}
              >
                试一下 →
              </SpecularButton>
            </div>
          </AnimatedContent>
        ))}
      </div>
    </section>
  );
}
