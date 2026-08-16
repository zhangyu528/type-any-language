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
 * 是「浏览全部 / 看数据 / 看收藏 / 去复习」的入口，各司其职。
 */

import AnimatedContent from '@/components/AnimatedContent';
import {
  BarChart3,
  Bookmark,
  GraduationCap,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';

import { DashboardSnapshot } from '../../api';
import { DashboardSection } from '../DashboardNav';
import styles from './QuickNav.module.css';

interface QuickNavProps {
  snapshot: DashboardSnapshot;
  /** 收藏句数（来自 dashboard 页维护的 collectionCount）。 */
  collectionCount: number;
  /** 待复习句数（来自 snapshot.review_due_count）。 */
  reviewDue: number;
  /** 跳转到对应分区（= setSection，纯导航）。 */
  onNavigate: (section: DashboardSection) => void;
}

interface Tile {
  key: DashboardSection;
  label: string;
  icon: LucideIcon;
  /** 主数字（可选）。收藏 / 复习用整型计数驱动回访。 */
  count?: number;
  /** 副文本。 */
  sub: string;
  /** 复习卡高亮（待复习 > 0 时用琥珀色吸引回访）。 */
  hot?: boolean;
  /** 弱化态（如复习为 0）。 */
  muted?: boolean;
}

export default function QuickNav({
  snapshot,
  collectionCount,
  reviewDue,
  onNavigate,
}: QuickNavProps) {
  const dailyPct = Math.round((snapshot.daily_goal?.pct ?? 0) * 100);
  const acc7 = snapshot.progress?.accuracy_7d?.value;

  const tiles: Tile[] = [
    {
      key: 'practice',
      label: '课程',
      icon: GraduationCap,
      sub: dailyPct > 0 ? `今日目标 ${dailyPct}%` : '挑选词库',
    },
    {
      key: 'data',
      label: '数据',
      icon: BarChart3,
      sub: acc7 != null ? `命中率 ${Math.round(acc7)}%` : '查看统计',
    },
    {
      key: 'collection',
      label: '收藏',
      icon: Bookmark,
      count: collectionCount,
      sub: collectionCount > 0 ? '已收藏句子' : '空',
    },
    {
      key: 'review',
      label: '复习',
      icon: RefreshCw,
      count: reviewDue,
      sub: reviewDue > 0 ? '待复习句子' : '暂无待复习',
      hot: reviewDue > 0,
      muted: reviewDue === 0,
    },
  ];

  return (
    <AnimatedContent distance={16} direction="vertical" className={styles.wrap}>
      <p className={styles.label}>快速入口</p>
      <div className={styles.grid}>
        {tiles.map((t) => {
          const Icon = t.icon;
          const cls = [
            styles.card,
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
                  <span
                    className={`${styles.bigNum} ${t.muted ? styles.bigNumMuted : ''}`}
                  >
                    {t.count}
                  </span>
                ) : null}
                <span className={styles.sub}>{t.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
    </AnimatedContent>
  );
}
