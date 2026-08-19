'use client';

/**
 * FirstRunGuide — 注册后首屏欢迎页(2026-08 改好版)。
 *
 * 纯欢迎 Hero:问候新用户 + 一句话说明产品玩法,主按钮「进入主页 →」
 * 直接进概览(主页)。不再强推某个词库、也不再点词库跳练习——选词库是
 * 进入主页后「开始第一句」卡 / 我的课程 的明确动作,而非欢迎页的职责。
 *
 * 仅当 isFirstRun(从未练习过)时由 OverviewSection 渲染,无论注册时是否
 *  选了词库——选了词库会额外在标题下展示「已为你添加《X》」胶囊;点
 *  「进入主页 →」后 OverviewSection 关掉本引导(会话内只欢迎一次)。
 */

import styles from './FirstRunGuide.module.css';

interface FirstRunGuideProps {
  /** 新用户展示名,用于「欢迎加入，X ✨」。 */
  userName?: string | null;
  /** 点「进入主页 →」→ 关掉本引导,渲染正常概览(通用注册无选词库时即主按钮)。 */
  onEnterHome: () => void;
  /** 从 landing 选了词库注册而来:该词库已加入「我的课程」,于标题下展示
   *  「你即将开始《X》」胶囊,确认课程已就位。通用注册(无选词库)不传。 */
  enrolledLibName?: string | null;
  /** 选了词库时提供:主按钮变为「开始《X》」,直接进练习页开练该课
   *  (而非仅进概览)。通用注册不传,主按钮即「进入主页」。 */
  onStartCourse?: () => void;
}

const BookIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2z" />
    <path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z" />
  </svg>
);

const HearIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12h2l2-5 3 10 3-14 2 9h4" />
  </svg>
);

const CheckIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);

const STEPS = [
  { n: 1, label: '选词库', hint: '挑一份适合你的', icon: BookIcon },
  { n: 2, label: '听音敲写', hint: '逐字打出听到的', icon: HearIcon },
  { n: 3, label: '看反馈', hint: '即时纠错巩固', icon: CheckIcon },
];

export default function FirstRunGuide({
  userName,
  onEnterHome,
  enrolledLibName,
  onStartCourse,
}: FirstRunGuideProps) {
  return (
    <section className={styles.root} aria-label="欢迎">
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.badge} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
          <path d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16l-1.8-5L5 9.2l5.2-1.8z" />
          <path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9z" opacity="0.7" />
        </svg>
      </div>

      <p className={styles.kicker}>新账号 · 第一步</p>
      <h2 className={styles.title}>{`欢迎加入，${userName ?? ''} ✨`}</h2>
      {enrolledLibName ? (
        <p className={styles.enrolled}>
          <span aria-hidden="true">📚</span>
          你即将开始《<span className={styles.enrolledName}>{enrolledLibName}</span>》的学习
        </p>
      ) : null}
      <p className={styles.sub}>
        听音 → 逐字敲写 → 即时反馈。三步循环，不知不觉把一个词刻进肌肉记忆。
      </p>

      <ol className={styles.steps}>
        {STEPS.map((s, i) => (
          <li key={s.n} className={styles.step}>
            <span className={styles.stepIcon}>{s.icon}</span>
            <span className={styles.stepLabel}>{s.label}</span>
            <span className={styles.stepHint}>{s.hint}</span>
            {i < STEPS.length - 1 ? (
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {enrolledLibName && onStartCourse ? (
        <>
          <button type="button" className={styles.primary} onClick={onStartCourse}>
            {`开始《${enrolledLibName}》 →`}
          </button>
          <button type="button" className={styles.secondary} onClick={onEnterHome}>
            先去主页看看
          </button>
        </>
      ) : (
        <button type="button" className={styles.primary} onClick={onEnterHome}>
          进入主页 →
        </button>
      )}

      <p className={styles.note}>
        {enrolledLibName
          ? '《' + enrolledLibName + '》已加入「我的课程」，点上方按钮即可直接开练。'
          : '进入主页后点「开始第一句」即可开练；也可随时在「我的课程」里挑一份合适的词库。'}
      </p>
    </section>
  );
}
