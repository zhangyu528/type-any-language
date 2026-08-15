'use client';

/**
 * DataSection — the "数据" partition: deep-dive analytics that go
 * beyond the overview hero.
 *
 *   - ProgressSnapshot  — 3 KPI tiles (accuracy / sentences / new words)
 *   - TrendChart        — 35-day sentences + accuracy lines (from the
 *                         snapshot's calendar; no new endpoint)
 *   - LearnedLibProgress— per-lib completion (real progress, not avatars)
 *   - WeekRhythm        — current-week dots + day-detail drawer
 *
 * Heavier than the other sections (animations + the SVG chart), so
 * page.tsx lazy-loads it via next/dynamic.
 */

import { DashboardSnapshot } from '../../api';
import ProgressSnapshot from '../ProgressSnapshot';
import TrendChart from '../TrendChart';
import LearnedLibProgress from '../LearnedLibProgress';
import WeekRhythm from '../WeekRhythm';
import styles from './DataSection.module.css';

interface DataSectionProps {
  snapshot: DashboardSnapshot;
}

export default function DataSection({ snapshot }: DataSectionProps) {
  return (
    <div className={styles.root}>
      <ProgressSnapshot kpis={snapshot.progress} />
      <TrendChart days={snapshot.calendar} />
      <LearnedLibProgress userId={snapshot.user.id} />
      <WeekRhythm days={snapshot.calendar} />
    </div>
  );
}
