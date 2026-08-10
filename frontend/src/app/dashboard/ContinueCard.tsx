'use client';

/**
 * ContinueCard — "where did I left off" surface + black scenario demo card.
 *
 * Three states driven by ContinueState:
 *   - has-unfinished session → "Resume Practice" CTA
 *   - has-finished session (no unfinished) → "Practice again" CTA
 *   - no sessions yet → "Start your first lesson" (opens the
 *     dashboard's in-place lib picker)
 *
 * Layout (Option B style fusion):
 *   ┌──────────────────────────┬────────────────────────┐
 *   │ Left: caption + preview  │ Right: black demo card  │
 *   │ + position + amber CTA   │ (方案 B 视觉锚点)        │
 *   └──────────────────────────┴────────────────────────┘
 *   窄屏(<640px) 退化为单栏垂直堆叠
 *
 * The CTA is a SpecularButton (reactbits.dev port): solid amber
 * `--ds-cta` fill with a WebGL specular highlight that follows the
 * cursor. Right column borrows the "教学演示优先" black scenario
 * card from the landing page, giving dashboard a brand-coherent
 * visual anchor without losing the dashboard's Slate+Amber palette.
 */

import { ContinueState } from '../api';
import { SpecularButton } from '@/components/effects';
import styles from './ContinueCard.module.css';

export interface ContinueCardProps {
  state: ContinueState;
  /** CTA handler when there's an existing session to resume. */
  onResume: () => void;
  /** CTA handler when the user needs to pick a lib (first-time / no last lib). */
  onPickLib: () => void;
}

export default function ContinueCard({ state, onResume, onPickLib }: ContinueCardProps) {
  const hasSession = state.session_id !== null;
  const handleClick = hasSession ? onResume : onPickLib;

  const cta = !hasSession
    ? 'Start your first lesson'
    : state.is_unfinished
      ? 'Resume Practice'
      : 'Practice again';

  const preview = state.preview || (hasSession ? 'Free practice' : 'No active session yet');
  const positionLabel = hasSession && state.current_sentence_position > 0
    ? `Word #${state.current_sentence_position}`
    : null;

  // 黑色 demo 卡内容 —— 与 landing Onboarding 共享同一组场景句
  // 未来可以接 sentenceProgress 抽一句真实待练句子
  const demoZh = state.preview?.split(' / ')[0] || '我每天早上喝咖啡。';
  const demoEn = state.preview?.split(' / ')[1] || 'I drink coffee every morning.';

  return (
    <section className={styles.root} aria-label="continue practice">
      {/* 左栏:文字 + CTA */}
      <div className={styles.body}>
        <p className={styles.caption}>Continue</p>
        <p className={styles.preview}>{preview}</p>
        {positionLabel ? <p className={styles.position}>{positionLabel}</p> : null}
        {/* SpecularButton — solid amber (--ds-cta) fill with WebGL rim
            that follows the cursor. */}
        <SpecularButton
          size="md"
          onClick={handleClick}
          radius={14}
          tint="#BA7517"
          tintOpacity={1}
          textColor="#FFFFFF"
          lineColor="#FFFFFF"
          baseColor="#854F0B"
          blur={8}
          intensity={1.5}
          shineSize={14}
          shineFade={50}
          followMouse
          proximity={480}
          className={styles.cta}
        >
          {cta} →
        </SpecularButton>
      </div>

      {/* 右栏:黑色场景演示卡 —— 方案 B 标志性元素 */}
      <aside className={styles.demoCard} aria-label="今日练习预览">
        <p className={styles.demoKicker}>Today's sentence</p>
        <p className={styles.demoZh}>{demoZh}</p>
        <p className={styles.demoEn}>{demoEn}</p>
        <p className={styles.demoHint}>
          <span>听完逐字敲一遍</span>
          <span className={styles.demoHintBadge}>▶ Auto</span>
        </p>
      </aside>
    </section>
  );
}
