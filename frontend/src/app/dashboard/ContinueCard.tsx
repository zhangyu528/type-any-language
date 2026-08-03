'use client';

/**
 * ContinueCard — "where did I left off" surface.
 *
 * Three states driven by ContinueState:
 *   - has-unfinished session → "Resume Practice" CTA
 *   - has-finished session (no unfinished) → "Practice again" CTA
 *   - no sessions yet → "Start your first lesson" (opens the
 *     dashboard's in-place lib picker)
 *
 * The card is now router-agnostic — its parent decides how to
 * route the CTA. For the dashboard this means an in-place state
 * transition (no Next Router push), because lib selection is a
 * dashboard-local action for signed-in users. Anonymous visitors
 * still go through `/practice?lib=X` via the page.tsx path, but
 * that's the landing/LibShowcase flow — ContinueCard never runs
 * there.
 */

import { ContinueState } from '../api';
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

  return (
    <section className={styles.root} aria-label="continue practice">
      <p className={styles.caption}>Continue</p>
      <p className={styles.preview}>{preview}</p>
      {positionLabel ? <p className={styles.position}>{positionLabel}</p> : null}
      <button
        type="button"
        className={styles.cta}
        onClick={handleClick}
      >
        {cta} →
      </button>
    </section>
  );
}
