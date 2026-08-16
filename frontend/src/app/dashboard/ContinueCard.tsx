'use client';

/**
 * ContinueCard — the dashboard's single primary action: start (or resume)
 * the current in-progress course.
 *
 * Anchors to the current course (prefs.libId / 我的课程 选择), so switching
 * the current course in 我的课程 updates this card's course name + progress.
 * CTA reads neutrally as "开始练习" (no "继续练习 / 再练一次" wording); the
 * resume behavior is still wired — when the current course has an unfinished
 * session, the CTA routes through onResume to continue that session.
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

import { Catalog, ContinueState } from '../api';
import SpecularButton from '@/components/SpecularButton';
import styles from './ContinueCard.module.css';

export interface ContinueCardProps {
  state: ContinueState;
  /** 当前所选课程（首页 recentLib，源自 prefs.libId）。用于把卡片内容锚定到
   *  用户正在学的那门课，并在它与上次 session 的课程不一致时给出一键切换。 */
  currentLib?: { id: string; name: string } | null;
  /** 课程目录：把 state.lib_id 解析成课程名显示（联动的关键数据）。 */
  catalog?: Catalog | null;
  /** CTA handler when there's an existing session to resume. */
  onResume: () => void;
  /** CTA handler when the user needs to pick a lib (first-time / no last lib). */
  onPickLib: () => void;
  /** 直接开某门课的练习（空态直达当前课 / 「切到当前课程」）。 */
  onStartLib?: (libId: string) => void;
  /** 锚定课程的总进度（localStorage 逐句进度），用于卡片内进度条填补空白。 */
  currentProgress?: { pct: number; remain: number } | null;
  /** 今日状态：未达标(落后)=true → 区域主色琥珀；达标=done → 薄荷绿。 */
  behind?: boolean;
}

export default function ContinueCard({
  state,
  currentLib,
  catalog,
  onResume,
  onPickLib,
  onStartLib,
  currentProgress,
  behind,
}: ContinueCardProps) {
  const hasSession = state.session_id !== null;

  // 上次 session 的课程名（来自 continue.lib_id）。
  const lastId = state.lib_id;
  const lastName =
    lastId && catalog
      ? catalog.libs.find((l) => l.id === lastId)?.name ?? null
      : null;

  // 当前所选课程（prefs.libId）。
  const selId = currentLib?.id ?? null;
  const selName = currentLib?.name ?? null;

  // 上次练的课 ≠ 当前在学的课 → 提示并允许一键切换。
  const mismatch = Boolean(
    hasSession && lastId && selId && lastId !== selId && onStartLib,
  );

  // 卡片锚定的课程名：优先「当前进行中课程」(selId，来自 我的课程 选择 /
  // prefs.libId)；仅当无当前课时才回退到上次 session 的课——这样 我的课程
  // 切换当前课程时，本卡的课程名与进度条会跟着联动。
  const courseName = selName ?? lastName;

  // 主 CTA 行为：当前课有未完成 session → 续练该 session；否则开/继续当前课；
  // 再否则挑库。卡片锚定当前课程，故切换 我的课程 后 CTA 也跟着当前课走。
  const handleClick = () => {
    if (hasSession && lastId && selId && lastId === selId && onResume) {
      onResume();
    } else if (selId && onStartLib) {
      onStartLib(selId);
    } else {
      onPickLib();
    }
  };

  // CTA 文案：当前课有练习进度(pct>0)=练过 → 「继续练习」，否则「开始练习」；
  // 无当前课(空态) → 「开始第一句」。卡片不再单独显示 title（kicker 已是标题）。
  const cta = selId
    ? currentProgress && currentProgress.pct > 0
      ? '继续练习'
      : '开始练习'
    : '开始第一句';

  // 仅当后端给出「Lesson N」这类有信息量的上下文时，才作为预览行展示；
  // 泛化的 "Lib practice" / "Free practice" 冗余（课程 pill 已说明在练哪门课），
  // 一律不显示，改由下方进度条承载卡片内容。
  const lessonPreview = state.preview?.startsWith('Lesson') ? state.preview : null;

  // 无任何课程上下文时的兜底提示（无 session 且无当前课）。
  const fallbackPreview =
    !courseName && !lessonPreview
      ? hasSession
        ? '自由练习 · 听完音频后逐字敲写'
        : selName
          ? `点击开始，从《${selName}》的第一句逐字听写`
          : '挑一个词库，开始你的第一句'
      : null;

  // Resume context: where the user left off.
  const positionLabel =
    hasSession && state.current_sentence_position > 0
      ? `上次停在 第 ${state.current_sentence_position} 句`
      : null;

  return (
    <section
      className={styles.root}
      data-status={behind ? 'behind' : 'done'}
      aria-label="开始练习"
    >
      <p className={styles.kicker}>听音打字 · 一句话学会</p>

      {courseName ? (
        <p className={styles.course}>
          <span className={styles.courseDot} aria-hidden="true" />
          <span className={styles.courseName}>{courseName}</span>
        </p>
      ) : null}

      {lessonPreview ? <p className={styles.preview}>{lessonPreview}</p> : null}
      {fallbackPreview ? <p className={styles.preview}>{fallbackPreview}</p> : null}

      {currentProgress && courseName ? (
        <div className={styles.progressRow}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuenow={currentProgress.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={styles.progressFill}
              style={{ width: `${currentProgress.pct}%` }}
            />
          </div>
          <span className={styles.progressMeta}>
            {currentProgress.pct >= 100 ? '已通关' : `还差 ${currentProgress.remain} 句`}
            {' · '}
            {currentProgress.pct}%
          </span>
        </div>
      ) : null}

      {positionLabel ? <p className={styles.position}>{positionLabel}</p> : null}

      {mismatch && selName ? (
        <p className={styles.switchHint}>
          你当前在《{selName}》
          <button
            type="button"
            className={styles.switchBtn}
            onClick={() => onStartLib?.(selId!)}
          >
            去那里练 →
          </button>
        </p>
      ) : null}

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
