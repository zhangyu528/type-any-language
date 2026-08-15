'use client';

/**
 * ContinueCard — the dashboard's single primary action: "where did I
 * leave off / start now".
 *
 * Three states driven by ContinueState:
 *   - has-unfinished session → "继续练习"
 *   - has-finished session (no unfinished) → "再练一次"
 *   - no sessions yet → "开始练习" (opens the in-place lib picker)
 *
 * The product's core loop is 听音 → 逐字敲写 → 反馈, so the card leads
 * with that mechanic (kicker) and shows the real last-session context
 * when available. We never fabricate an English sentence: the app is
 * multilingual, a hardcoded English line would be wrong for
 * non-English learners and misleading to screen readers.
 *
 * Layout: single column, fills the left half of the "今日" glass panel.
 * The CTA is a SpecularButton (reactbits.dev port): solid amber
 * `--ds-cta` fill with a WebGL specular highlight that follows the
 * cursor.
 */

import { ContinueState } from '../api';
import SpecularButton from '@/components/SpecularButton';
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

  const caption = !hasSession
    ? '开始练习'
    : state.is_unfinished
      ? '继续练习'
      : '再练一次';

  const cta = !hasSession
    ? '开始第一句'
    : state.is_unfinished
      ? '继续练习'
      : '再练一次';

  // Real context only. Free practice sessions may not carry a preview
  // sentence — fall back to a neutral, product-grounded prompt rather
  // than inventing one (especially not in English).
  const preview = state.preview
    ? state.preview
    : hasSession
      ? '自由练习 · 听完音频后逐字敲写'
      : '挑一个词库，开始你的第一句';

  // Resume context: where the user left off. The lib/session context
  // is already shown in `preview` above, so this line reads as
  // "上次停在《XX》第 N 句" without re-stating the lib name.
  const positionLabel =
    hasSession && state.current_sentence_position > 0
      ? `上次停在 第 ${state.current_sentence_position} 句`
      : null;

  return (
    <section className={styles.root} aria-label="继续练习">
      <p className={styles.kicker}>听音打字 · 一句话学会</p>
      <p className={styles.caption}>{caption}</p>
      <p className={styles.preview}>{preview}</p>
      {positionLabel ? <p className={styles.position}>{positionLabel}</p> : null}
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
    </section>
  );
}
