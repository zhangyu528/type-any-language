'use client';

/**
 * TodaySuggestion — 个性化今日建议（方向 B 新模块）。
 *
 * 基于「用户状态」算力生成一句下一步建议，整卡可点 → 直驱练习：
 *   1. 断卡风险（连续>0 且今日未练）→ 护盾态，最高优先级
 *   2. 今日目标临近达标（剩 ≤5 句）→ 顺手清掉
 *   3. 有练习习惯时段 → "通常 HH:00 是你练习时间"
 *   4. 兜底 → 保持手感
 *
 * 这是概览里唯一会"主动建议下一步"的入口，替代原先只是一行
 * "通常 HH:00 练习" 的低对比提示。点击优先进入最近词库，无最近词库
 * 时退回选词库。
 */

import { useMemo } from 'react';
import { ShieldAlert, Lightbulb, Clock, Sparkles } from 'lucide-react';
import { DailyGoalState, StreakInfo } from '../../api';
import styles from './TodaySuggestion.module.css';

interface TodaySuggestionProps {
  preferredHour?: number | null;
  streak: StreakInfo;
  dailyGoal: DailyGoalState;
  recentLibId?: string | null;
  recentLibName?: string | null;
}

type Tone = 'shield' | 'goal' | 'habit' | 'neutral';
type IconType = typeof Lightbulb;

export default function TodaySuggestion({
  preferredHour,
  streak,
  dailyGoal,
  recentLibId,
  recentLibName,
}: TodaySuggestionProps) {
  const suggestion = useMemo(() => {
    const atRisk = streak.current > 0 && !streak.today_done;
    const remaining = Math.max(0, dailyGoal.target - dailyGoal.today_count);
    const hasTarget = Boolean(recentLibId);

    if (atRisk) {
      return {
        tone: 'shield' as Tone,
        kicker: '护住连击',
        title: `连续 ${streak.current} 天就断了，今天来一句保住`,
        sub: hasTarget ? `最近在练《${recentLibName}》` : '挑个词库练一句',
        icon: ShieldAlert as IconType,
      };
    }
    if (!dailyGoal.completed && remaining <= 5) {
      return {
        tone: 'goal' as Tone,
        kicker: '今日目标',
        title: `还差 ${remaining} 句达标，顺手清掉`,
        sub: hasTarget ? `最近在练《${recentLibName}》` : '挑个词库练一句',
        icon: Sparkles as IconType,
      };
    }
    if (preferredHour != null) {
      const period =
        preferredHour < 6
          ? '凌晨'
          : preferredHour < 12
            ? '上午'
            : preferredHour < 18
              ? '下午'
              : '晚上';
      return {
        tone: 'habit' as Tone,
        kicker: '习惯时刻',
        title: `你常在${period}练习`,
        sub: '现在来一句，趁手感正好',
        icon: Clock as IconType,
      };
    }
    return {
      tone: 'neutral' as Tone,
      kicker: '守住火花',
      title: '今天也来一句，保持手感',
      sub: hasTarget ? `最近在练《${recentLibName}》` : '挑个词库开始',
      icon: Lightbulb as IconType,
    };
  }, [streak, dailyGoal, preferredHour, recentLibId, recentLibName]);

  const Icon = suggestion.icon;

  return (
    <section className={`${styles.root} ${styles[suggestion.tone]}`}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className={styles.body}>
        <span className={styles.kicker}>{suggestion.kicker}</span>
        <span className={styles.title}>{suggestion.title}</span>
        <span className={styles.sub}>{suggestion.sub}</span>
      </span>
    </section>
  );
}
