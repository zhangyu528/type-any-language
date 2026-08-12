'use client';

/**
 * ScenariosSection — 方案 B SECTION 2(2026-08 polish, shadcn 重构)
 *
 * shadcn MagicBento 不接外部 cards prop — 卡内容是组件内硬编码的 6 张
 * 英文 Analytics/Dashboard/Collaboration/Automation/Integration/Security 演示。
 * 因此本 section 不再承载"4 个中文场景 + SpecularButton 跟打"内容,
 * 仅保留 section header + shadcn MagicBento 自带的演示卡。
 *
 * SCENES 数据保留在文件里供未来扩展,目前不渲染。
 */

import MagicBento from '@/components/MagicBento';
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
  { emoji: '✈️', name: 'Travel',       zh: '火车站在哪里?',    en: 'Where is the train station?' },
  { emoji: '💼', name: 'Workplace',    zh: '我们约个会议吧',   en: "Let's schedule a meeting." },
  { emoji: '🎉', name: 'Social',       zh: '你好,认识你很高兴', en: 'Nice to meet you, Alex.' },
];

interface ScenariosSectionProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

export default function ScenariosSection({
  libs: _libs,
  onPickLib: _onPickLib,
}: ScenariosSectionProps) {
  return (
    <section className={styles.root} aria-labelledby="scenarios-title">
      <AnimatedContent distance={20} delay={0 / 1000} direction="vertical" className={styles.header}>
        <p className={styles.kicker}>SECTION 2 · 4 个真实场景</p>
        <h2 id="scenarios-title" className={styles.title}>
          选一个场景,读一句话。
        </h2>
        <p className={styles.subtitle}>4 个开口场景,从这里读。</p>
      </AnimatedContent>

      {/* shadcn MagicBento:硬编码 6 张英文示例卡(Analytics/Dashboard 等) */}
      <MagicBento
        className={styles.bento}
        enableSpotlight
        enableBorderGlow
        clickEffect
        spotlightRadius={420}
        glowColor="143, 203, 240"
      />
    </section>
  );
}