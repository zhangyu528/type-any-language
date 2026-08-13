'use client';

/**
 * StatsTab — aggregate stats + per-lib progress table.
 *
 * The 总览统计 (overview) section uses the MagicBento effect from
 * reactbits.dev: 5 cards arranged in a custom 3-col bento (1 hero
 * on the left + 2x2 side stack on the right), each with cursor-
 * follow border glow + global spotlight. Card bodies use
 * AnimatedCounter for the big numbers; the per-card label slot
 * uses our mono-uppercase pattern for "已练词库" / "已判句子" etc.
 *
 * MagicBentoCard's `children` slot replaces the default
 * title+description block (added in our port) so we can put
 * AnimatedCounter + hint inside.
 *
 * 词库进度 (lib progress) section uses motion stagger on the
 * table rows + AnimatedCounter for the per-row accuracy.
 */
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Catalog,
  loadTranslationProgress,
  TranslationProgress,
  getDashboardSnapshot,
  type DashboardSnapshot,
} from '../api';
import MagicBento from '@/components/MagicBento';
import VariableProximity from '@/components/VariableProximity';
import Counter from '@/components/Counter';
import { riseIn, staggerParent } from '../ds/motion';
import styles from '../me/me-page.module.css';

interface StatsTabProps {
  catalog: Catalog | null;
  catalogError: string | null;
  /** Per-user localStorage namespace key. */
  userId: string;
}

export default function StatsTab({ catalog, catalogError, userId }: StatsTabProps) {
  const [progress, setProgress] = useState<TranslationProgress>({});
  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    setProgress(loadTranslationProgress(userId));
    setHydrated(true);
    const onProgressChanged = () => {
      setProgress(loadTranslationProgress(userId));
    };
    window.addEventListener('translation-progress-changed', onProgressChanged);
    return () => {
      window.removeEventListener('translation-progress-changed', onProgressChanged);
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getDashboardSnapshot();
        if (cancelled) return;
        setSnapshot(s);
      } catch (e) {
        if (!cancelled) {
          setSnapshotError(e instanceof Error ? e.message : '加载 dashboard 失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = computeKpis(progress);
  const libRows = catalog ? computeLibRows(progress, catalog) : [];

  const todayCount = snapshot?.daily_goal?.today_count ?? null;
  const todayTarget = snapshot?.daily_goal?.target ?? null;
  const streakCurrent = snapshot?.streak?.current ?? 0;
  const streakLongest = snapshot?.streak?.longest ?? 0;

  const todayHint =
    todayCount != null && todayTarget
      ? todayCount >= todayTarget
        ? '今日目标已达成'
        : `今日目标 ${todayCount} / ${todayTarget}`
      : null;

  const streakHint =
    streakCurrent === 0
      ? '开始 7 天连击'
      : streakLongest > streakCurrent
        ? `历史最长 ${streakLongest} 天`
        : `已连续 ${streakCurrent} 天`;

  // MagicBento cards — 1 hero (accuracy) + 4 supporting. Hero spans
  // the full 2 rows on the left; the 4 supporting cards fill the
  // 2x2 grid on the right. The CSS override is in me-page.module.css
  // (`.me-magic-bento > div > div:first-child` for hero placement).
  const accuracyValue = kpis.accuracy;
  const accuracyHint = !hydrated
    ? '加载中…'
    : accuracyValue != null
      ? `基于 ${kpis.sentencesTotal} 句`
      : '完成第一句练习后开始统计';


  return (
    <div className={styles['me-stats']}>
      <section aria-label="总览统计">
        <KickerLabel>总览统计</KickerLabel>
        <div className={styles['me-magic-bento-wrap']}>
          {/* shadcn MagicBento:硬编码 6 张英文示例卡 */}
          <MagicBento
            glowColor="91, 168, 240"
            spotlightRadius={420}
            enableBorderGlow
            enableSpotlight
            className={styles['me-magic-bento']}
          />
        </div>
      </section>

      <section className={styles['me-stats__libs']} aria-label="词库进度">
        <KickerLabel>词库进度</KickerLabel>
        {!catalog ? (
          <p className={styles['me-empty']}>
            {catalogError ? `加载词库失败:${catalogError}` : '加载词库中…'}
          </p>
        ) : libRows.length === 0 ? (
          <p className={styles['me-empty']}>
            还没有开始练习,先去挑个词库试试 →
          </p>
        ) : (
          <motion.table
            className={styles['me-lib-table']}
            variants={staggerParent}
            initial="hidden"
            animate="show"
          >
            <thead>
              <tr>
                <th scope="col">词库</th>
                <th scope="col" className={styles['me-lib-table__num']}>已练</th>
                <th scope="col" className={styles['me-lib-table__num']}>正确率</th>
                <th scope="col" className={styles['me-lib-table__num']}>错题</th>
              </tr>
            </thead>
            <tbody>
              {libRows.map((row) => (
                <motion.tr key={row.libId} variants={riseIn}>
                  <th scope="row" className={styles['me-lib-table__name']}>
                    {row.libName}
                  </th>
                  <td className={styles['me-lib-table__num']}>{row.answered}</td>
                  <td className={styles['me-lib-table__num']}>
                    <AccuracyBar accuracy={row.accuracy} />
                  </td>
                  <td className={styles['me-lib-table__num']}>{row.wrong}</td>
                </motion.tr>
              ))}
            </tbody>
          </motion.table>
        )}
      </section>
    </div>
  );
}

/** VariableProximity kicker — used by both StatsTab section
 *  headings. Wrapped in a label so screen readers and CSS-class
 *  selectors can still find it. */
function KickerLabel({ children }: { children: string }) {
  return (
    <h2 className={styles['me-section-title']}>
      <VariableProximity
        label={children}
        fromFontVariationSettings={{ wght: 400 }}
        toFontVariationSettings={{ wght: 700 }}
        radius={80}
        falloff="linear"
        className={styles['me-section-title__prox']}
      />
    </h2>
  );
}

/** Stat body for the 4 supporting cards. Renders an AnimatedCounter
 *  + static unit + optional hint. When value is null (data not yet
 *  loaded) we render "—" as a placeholder. */
function StatBody({
  value,
  unit,
  hint,
  achievement,
}: {
  value: number | null;
  unit: string;
  hint?: string;
  achievement?: boolean;
}) {
  return (
    <div
      className={styles['me-mb-stat']}
      data-achievement={achievement ? 'true' : 'false'}
    >
      <div className={styles['me-mb-stat__number']}>
        {value != null ? (
          <>
            <Counter value={value} fontSize={40} className={styles['me-mb-stat__counter']} />
            <span className={styles['me-mb-stat__unit']} aria-hidden>{unit}</span>
          </>
        ) : (
          <span className={styles['me-mb-empty']}>—</span>
        )}
      </div>
      {hint ? <p className={styles['me-mb-stat__hint']}>{hint}</p> : null}
    </div>
  );
}

function AccuracyBar({ accuracy }: { accuracy: number | null }) {
  const target = accuracy == null ? 0 : accuracy;
  return (
    <span className={styles['me-accuracy']} aria-label={`正确率 ${target}%`}>
      <span className={styles['me-accuracy__track']}>
        <motion.span
          className={styles['me-accuracy__fill']}
          initial={{ width: 0 }}
          whileInView={{ width: `${target}%` }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </span>
      <Counter
        value={target}
        fontSize={64}
        className={styles['me-accuracy__counter']}
      />
      <span className={styles['me-accuracy__unit']} aria-hidden>%</span>
    </span>
  );
}

// ----- Pure helpers -----

interface Kpis {
  libsCount: number;
  sentencesTotal: number;
  /** null when no answers exist (avoid "NaN%" / "0%" ambiguity). */
  accuracy: number | null;
}

function computeKpis(progress: TranslationProgress): Kpis {
  const libIds = Object.keys(progress);
  let total = 0;
  let correct = 0;
  for (const libId of libIds) {
    const sentences = progress[libId]?.sentences ?? {};
    for (const id in sentences) {
      const p = sentences[id];
      if (!p) continue;
      total += 1;
      if (p.correct) correct += 1;
    }
  }
  const libsCount = libIds.length;
  return {
    libsCount,
    sentencesTotal: total,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
  };
}

interface LibRow {
  libId: string;
  libName: string;
  answered: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
}

function computeLibRows(progress: TranslationProgress, catalog: Catalog): LibRow[] {
  const byId = new Map<string, VocabularyLibRowInput>(
    catalog.libs.map((l) => [l.id, l]),
  );
  for (const libId in progress) {
    if (!byId.has(libId)) {
      byId.set(libId, {
        id: libId,
        name: '已下架词库',
        level: '',
        word_count: 0,
      });
    }
  }
  const rows: LibRow[] = [];
  for (const [libId, lib] of byId) {
    const sentences = progress[libId]?.sentences ?? {};
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    for (const id in sentences) {
      const p = sentences[id];
      if (!p) continue;
      answered += 1;
      if (p.correct) correct += 1;
      else wrong += 1;
    }
    rows.push({
      libId,
      libName: lib.name,
      answered,
      correct,
      wrong,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
    });
  }
  rows.sort((a, b) => b.answered - a.answered);
  return rows;
}

interface VocabularyLibRowInput {
  id: string;
  name: string;
  level: string;
  word_count: number;
}
