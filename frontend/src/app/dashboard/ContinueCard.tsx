'use client';

/**
 * ContinueCard — "where did I leave off" surface.
 *
 * Three states driven by ContinueState:
 *   - has-unfinished session → "Resume Practice" CTA
 *   - has-finished session (no unfinished) → "Practice again" CTA
 *   - no sessions yet → "Start your first lesson" + library picker
 *     (the picker falls through to /practice landing for v1 — the
 *     future lib-grid picker lives in a later phase)
 *
 * CTA target:
 *   - When lib_id is known: /?lib=<id> — the existing /practice page
 *     already supports this query param.
 *   - When lib_id is null (free practice): / (homepage).
 */

import { useRouter } from 'next/navigation';
import { ContinueState } from '../api';
import styles from './ContinueCard.module.css';

export interface ContinueCardProps {
  state: ContinueState;
}

export default function ContinueCard({ state }: ContinueCardProps) {
  const router = useRouter();

  const hasSession = state.session_id !== null;
  const target = state.lib_id ? `/?lib=${encodeURIComponent(state.lib_id)}` : '/';

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
        onClick={() => router.push(target)}
      >
        {cta} →
      </button>
    </section>
  );
}