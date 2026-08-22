'use client';

/**
 * QuickNav — 主页总览的「快速入口」导航带。
 *
 * 放在 Hero 下方、现有「行动区」之前，是一条全宽导航带。四张卡
 * 各自带一个实时概览数，点击即跳到对应侧边栏分区（纯 setSection
 * 跳转，零额外数据请求——复习数来自 dashboard 单请求的
 * review_due_count，其余数复用 snapshot）。
 *
 * 与 ContinueCard（大号「继续」CTA，职责=继续上次）不冲突：这里
 * 是「浏览全部 / 看数据 / 看成就 / 去复习」的入口，各司其职。
 */

import AnimatedContent from '@/components/AnimatedContent';
import {
  BarChart3,
  GraduationCap,
  RefreshCw,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

import { Catalog, DashboardSnapshot } from '../../api';
import { DashboardSection } from '../DashboardNav';
import { deriveAchievements } from './achievements';
import styles from './QuickNav.module.css';

interface QuickNavProps {
  snapshot: DashboardSnapshot;
  /** 待复习句数（来自 snapshot.review_due_count）。 */
  reviewDue: number;
  /** 内容目录（page.tsx eager-load）。驱动「发现」卡的推荐课程数。 */
  catalog?: Catalog | null;
  /** 跳转到对应分区（= setSection，纯导航）。 */
  onNavigate: (section: DashboardSection) => void;
}

interface Tile {
  key: DashboardSection;
  label: string;
  icon: LucideIcon;
  /** 主数字（可选）。复习 / 成就用整型计数驱动回访。 */
  count?: number;
  /** 主数字的分母（成就用：已解锁 / 总数）。 */
  total?: number;
  /** 副文本。 */
  sub: string;
  /** 主数字的单位后缀（如 '%' / '门' / '句'）。成就用分母时不加。 */
  unit?: string;
  /** 周环比趋势（绝对值，带正负号决定 ▲/▼ 与配色）。成就/复习不传。 */
  delta?: number;
  /** 细进度条比例（0–1）。成就概览用：已解锁占比。 */
  progress?: number;
  /** 色调：每张卡一个独立 accent，提升快速扫读时的可分辨度。 */
  tone: 'action' | 'convert' | 'cta' | 'review';
  /** 复习卡高亮（待复习 > 0 时用琥珀色吸引回访）。 */
  hot?: boolean;
  /** 弱化态（如复习为 0）。 */
  muted?: boolean;
}

export default function QuickNav({
  snapshot,
  reviewDue,
  catalog,
  onNavigate,
}: QuickNavProps) {
  const ach = deriveAchievements(snapshot);

  // 发现：尚未加入（可开始）的课程数 → 「推荐课程」概览。
  const enrolled = snapshot.enrolled_lib_ids ?? [];
  const toExplore = catalog
    ? catalog.libs.filter((l) => !enrolled.includes(l.id)).length
    : 0;

  // 数据：本周新句 KPI（带周环比 delta）；缺则回退 7 日命中率。
  const newWords = snapshot.progress?.new_words ?? null;
  const acc7 = snapshot.progress?.accuracy_7d ?? null;

  const tiles: Tile[] = [
    {
      key: 'practice',
      label: '发现',
      icon: GraduationCap,
      tone: 'action',
      count: catalog ? toExplore : undefined,
      unit: '门',
      sub: catalog ? (toExplore > 0 ? '推荐课程' : '都已探索') : '推荐课程',
    },
    {
      key: 'data',
      label: '数据',
      icon: BarChart3,
      tone: 'convert',
      count: newWords?.value ?? acc7?.value,
      unit: newWords ? '句' : '%',
      sub: newWords ? '本周新句' : acc7 ? '7日命中率' : '暂无练习',
      delta: newWords?.delta ?? acc7?.delta,
    },
    {
      key: 'achievements',
      label: '等级和成就',
      icon: Trophy,
      tone: 'cta',
      count: ach.earnedCount,
      total: ach.totalCount,
      progress: ach.pct,
      sub:
        ach.earnedCount > 0
          ? ach.next
            ? `下个·${ach.next.label}`
            : '全部解锁'
          : '去解锁',
    },
    {
      key: 'review',
      label: '复习',
      icon: RefreshCw,
      tone: 'review',
      count: reviewDue,
      sub: reviewDue > 0 ? '待复习句子' : '已清空',
      hot: reviewDue > 0,
      muted: reviewDue === 0,
    },
  ];

  return (
    <AnimatedContent distance={16} direction="vertical" className={styles.wrap}>
      <div className={styles.grid}>
        {tiles.map((t) => {
          const Icon = t.icon;
          const toneCls =
            styles[`tone${t.tone.charAt(0).toUpperCase()}${t.tone.slice(1)}`];
          const cls = [
            styles.card,
            toneCls,
            t.hot ? styles.cardHot : '',
            t.muted ? styles.cardMuted : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={t.key}
              type="button"
              className={cls}
              onClick={() => onNavigate(t.key)}
              aria-label={`前往${t.label}`}
            >
              <span className={styles.cardTop}>
                <span className={styles.icon}>
                  <Icon size={18} />
                </span>
                <span className={styles.cardLabel}>{t.label}</span>
              </span>
              <span className={styles.cardBody}>
                {t.count != null ? (
                  <span className={styles.bigNumWrap}>
                    <span
                      className={`${styles.bigNum} ${t.muted ? styles.bigNumMuted : ''}`}
                    >
                      {t.count}
                    </span>
                    {t.total != null ? (
                      <span className={styles.bigDenom}>/{t.total}</span>
                    ) : null}
                    {t.unit ? (
                      <span className={styles.unit}>{t.unit}</span>
                    ) : null}
                    {t.delta != null && t.delta !== 0 ? (
                      <span
                        className={`${styles.trend} ${t.delta > 0 ? styles.trendUp : styles.trendDown}`}
                        aria-hidden="true"
                      >
                        {t.delta > 0 ? '▲' : '▼'}
                        {Math.abs(t.delta)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className={styles.sub}>{t.sub}</span>
              </span>
              {t.progress != null ? (
                <span className={styles.tileBar} aria-hidden="true">
                  <span
                    className={styles.tileFill}
                    style={{ width: `${Math.round(t.progress * 100)}%` }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </AnimatedContent>
  );
}
