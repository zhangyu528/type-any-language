'use client';

/**
 * ScenariosSection — 方案 B SECTION 2(2026-08 polish)
 *
 * 4 个真实场景卡(咖啡馆/旅行/职场/社交),
 * 每张卡 = "完整跟打示意":emoji + 场景名 + 中文提示 + BlurText 英文 + 按钮。
 *
 * 业界标准 polish:
 *   - header 用 ScrollReveal 替 motion 散件(整页节奏一致)
 *   - 每张卡中文 BlurText 入场(模拟「读」)+ SpecularButton 强 intensity 跟随鼠标
 *   - MagicBento 的卡片自己已经是 role="button",让内嵌按钮独占点击事件
 *
 * SCENES 与 (auth)/ImmersiveAuth 的 SCENES 保持一致,
 * 跨页面(landing ↔ login/signup)的场景品牌统一。
 */

import { BlurText, MagicBento, ScrollReveal, SpecularButton } from '@/components/effects';
import type { MagicBentoCard } from '@/components/effects';
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
  { emoji: '✈️', name: 'Travel',       zh: '火车站在哪里?',    en: 'Where is the train station?' },
  { emoji: '💼', name: 'Workplace',    zh: '我们约个会议吧',   en: "Let's schedule a meeting." },
  { emoji: '🎉', name: 'Social',       zh: '你好,认识你很高兴', en: 'Nice to meet you, Alex.' },
];

interface ScenariosSectionProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

export default function ScenariosSection({
  libs,
  onPickLib,
}: ScenariosSectionProps) {
  const firstLibId = libs[0]?.id;

  return (
    <section className={styles.root} aria-labelledby="scenarios-title">
      <ScrollReveal y={20} delay={0} className={styles.header}>
        <p className={styles.kicker}>SECTION 2 · 4 个真实场景</p>
        <h2 id="scenarios-title" className={styles.title}>
          选一个场景,读一句话。
        </h2>
        <p className={styles.subtitle}>4 个开口场景,从这里读。</p>
      </ScrollReveal>

      <MagicBento
        className={styles.bento}
        cards={SCENES.map<MagicBentoCard>((scene, i) => ({
          icon: <span className={styles.emoji}>{scene.emoji}</span>,
          // children 模式下 MagicBento 跳过默认 title/description 渲染
          children: (
            <div className={styles.cardInner}>
              <div className={styles.cardSceneName}>{scene.name}</div>
              <p className={styles.cardZh}>{scene.zh}</p>
              <BlurText
                as="p"
                text={`"${scene.en}"`}
                className={styles.cardQuote}
                animateBy="words"
                delay={120 + i * 80}
                stepDuration={0.35}
                direction="bottom"
              />
              <div className={styles.cardSpacer} />
              <SpecularButton
                size="sm"
                tint="var(--specular-tint, #CFE3F2)"
                tintOpacity={0.55}
                textColor="var(--specular-text, #FFFFFF)"
                intensity={1.0}
                followMouse
                proximity={300}
                blur={6}
                className={styles.practiceBtn}
                disabled={!firstLibId}
                onClick={() => firstLibId && onPickLib(firstLibId)}
              >
                读这句 →
              </SpecularButton>
            </div>
          ),
        }))}
        enableBorderGlow
        enableSpotlight
        clickEffect
        spotlightRadius={420}
        glowColor="143, 203, 240"
      />
    </section>
  );
}