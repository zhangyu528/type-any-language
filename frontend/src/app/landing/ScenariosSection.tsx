'use client';

/**
 * ScenariosSection — 方案 B SECTION 2
 *
 * 4 个真实场景卡(咖啡馆/旅行/职场/社交),
 * 每张一句引号英文 + 中文 + 底部"读这句"按钮。
 *
 * 设计动机:让营销访客在 landing 上直接"试一下"每个场景,
 * 而不是被引导到 dashboard。按钮触发 onPickLib(第一个词库),
 * 把 demo 句子作为锚点跳进 /practice/?lib=X。
 *
 * 视觉:复用项目里的 MagicBento 组件(reactbits.dev/components/magic-bento
 * 的本地 port)。它给我们:
 *   - 鼠标 hover 时 conic-gradient border-glow 跟着光标转一圈
 *   - GlobalSpotlight 在整个 section 区域跟随鼠标打柔光
 *   - click ripple
 *   - 主题感知 card bg / ink / glow color 由我们通过 props + className 提供
 *
 * SCENES 与 (auth)/ImmersiveAuth 的 SCENES 保持一致,
 * 跨页面(landing ↔ login/signup)的场景品牌统一。
 */

import { motion } from 'motion/react';
import { MagicBento, SpecularButton } from '@/components/effects';
import type { MagicBentoCard } from '@/components/effects';
import { riseIn, staggerParent } from '../ds/motion';
import { VocabularyLib } from '../api';
import styles from './ScenariosSection.module.css';

const SCENES = [
  { emoji: '☕', name: 'Coffee Shop', en: '"I\u2019d like a latte, please."', zh: '咖啡馆点单' },
  { emoji: '✈️', name: 'Travel',       en: '"Where is the train station?"',  zh: '问路' },
  { emoji: '💼', name: 'Workplace',    en: '"Let\u2019s schedule a meeting."', zh: '职场约会议' },
  { emoji: '🎉', name: 'Social',       en: '"Nice to meet you, Alex."',     zh: '初次见面' },
] as const;

interface ScenariosSectionProps {
  libs: VocabularyLib[];
  onPickLib: (libId: string) => void;
}

export default function ScenariosSection({
  libs,
  onPickLib,
}: ScenariosSectionProps) {
  // "读这句"统一跳第一份词库(与 FinalCTA handleStart 同模式)。
  // 后续如果给每个场景配专属 lib,可改成 libs[i] 或 scene -> libId 映射。
  const firstLibId = libs[0]?.id;
  // 主题感知 glowColor:light 走婴儿蓝(143,203,240),
  // dark 走稍亮的婴儿蓝高光(207,227,242)。RGB 字符串不带 rgba 包裹。
  // 实际值由 CSS var 决定 — 见 ScenariosSection.module.css 的 [data-babyblue] / [data-theme=dark]
  // MagicBento 的 .card / .cardHeader / .cardContent 直接用 var(--ds-*) token
  // 渲染,无需在 TSX 切换主题。

  return (
    <section className={styles.root} aria-labelledby="scenarios-title">
      <motion.header
        className={styles.header}
        variants={staggerParent}
        initial="hidden"
        animate="show"
      >
        <motion.p className={styles.kicker} variants={riseIn}>
          SECTION 2 · 4 个真实场景(每一个微 demo)
        </motion.p>
        <motion.h2
          id="scenarios-title"
          className={styles.title}
          variants={riseIn}
        >
          选一个场景,读一句话。
        </motion.h2>
        <motion.p className={styles.subtitle} variants={riseIn}>
          4 个开口场景,从这里读。
        </motion.p>
      </motion.header>

      <MagicBento
        className={styles.bento}
        cards={SCENES.map<MagicBentoCard>((scene) => ({
          // emoji 用 icon slot(22px display serif),不混 label(mono uppercase
          // tracking 12px) 那个 slot — 它对小 emoji 太紧
          icon: <span className={styles.emoji}>{scene.emoji}</span>,
          // 不传 title / description:MagicBento 在 children 模式下跳过默认
          // 的 cardTitle + cardDescription 渲染 — 标题/引文/按钮全部塞 children。
          // 故意不设 onClick:MagicBento 卡 div 自己会变成 role="button",
          // 跟 SpecularButton 双重点击会跳两次;让内嵌按钮独占点击事件。
          children: (
            <div className={styles.cardInner}>
              <div className={styles.cardSceneName}>{scene.name}</div>
              <p className={styles.cardQuote}>{scene.en}</p>
              <p className={styles.cardZh}>{scene.zh}</p>
              <div className={styles.cardSpacer} />
              <SpecularButton
                size="sm"
                tint="var(--specular-tint, #CFE3F2)"
                tintOpacity={0.35}
                textColor="var(--specular-text, #FFFFFF)"
                intensity={0.4}
                className={styles.practiceBtn}
                disabled={!firstLibId}
                onClick={() => firstLibId && onPickLib(firstLibId)}
              >
                读这句
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