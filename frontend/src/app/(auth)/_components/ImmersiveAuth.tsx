'use client';

/**
 * ImmersiveAuth — 单字段步进式登录 / 注册
 * --------------------------------------------------------------
 * 整张表单 = 一根 CurvedInput,通过 step 状态机切换 placeholder / type /
 * icon / buttonText。每按一次 Enter / 提交按钮,推进到下一步。
 *
 * 反应式 (Direction A) 设计:
 *   登录  : 邮箱 → 密码                                      (2 步)
 *   注册  : 姓名 → 邮箱 → 密码                                (3 步)
 *
 * 视觉层级:
 *   TiltCard (3D 倾斜)
 *     └─ GlowCard (鼠标径向辉光)
 *          └─ shadcn Card (玻璃主卡)
 *               ├─ 左上步进计数器 (01 / 03)
 *               ├─ 居中标题 (登录 / 注册)
 *               ├─ CurvedInput 主体 (焦点所在)
 *               ├─ 左侧"上一步"链接 (步数 > 1 时)
 *               └─ 底部"切换登录 / 注册"链接
 *
 * 转场: 用 motion `AnimatePresence` 在 step 切换时让 CurvedInput 滑动进出
 * 左右各 40px,260ms,体感连续的"翻牌"。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import BorderGlow from '@/components/BorderGlow';
import CurvedInput from '@/components/CurvedInput';
import AnimatedContent from '@/components/AnimatedContent';
import { DriftWall } from './DriftWall';
import { apiForgotPassword } from '../../api';
import styles from './ImmersiveAuth.module.css';

/* 4 个真实场景 demo —— 登录/注册左面板展示
 * 与 landing onboarding / 未来的"教学演示"组件共享 */
const SCENES = [
  { emoji: '☕', name: 'Coffee Shop', en: '"I\'d like a latte, please."', zh: '咖啡馆点单' },
  { emoji: '✈️', name: 'Travel',       en: '"Where is the train station?"',  zh: '问路' },
  { emoji: '💼', name: 'Workplace',    en: '"Let\'s schedule a meeting."', zh: '职场约会议' },
  { emoji: '🎉', name: 'Social',       en: '"Nice to meet you, Alex."',     zh: '初次见面' },
] as const;

interface ImmersiveAuthProps {
  mode: 'login' | 'signup';
  onSubmit: (data: {
    email?: string;
    password?: string;
    name?: string;
  }) => void;
  onSwitchMode: () => void;
  onClose?: () => void;
  isLoading?: boolean;
  /** 提交失败的服务器错误。优先级:submitError > error。 */
  submitError?: string | null;
  /** 用户在字段内开始输入时清空 submitError(由 AuthModal 拥有)。 */
  onClearSubmitError?: () => void;
  /**
   * P1-D: 提交成功状态。父级在拿到成功响应后延迟 600ms 再 close,
   * 这里负责渲染 check 圆圈 + 欢迎语的微动效。
   */
  success?: { email: string } | null;
}

type StepKey = 'email' | 'password';

interface StepDef {
  key: StepKey;
  type: string;
  placeholder: string;
  /** 无障碍 label — 关联到 CurvedInput 隐藏 input 的 id。 */
  label: string;
  buttonText: string;
  icon: React.ReactNode;
  /** 弧度递增:第 1 步更"碗"形,后续更克制 */
  bend: number;
  /** 0-based 校验时机:step 推进时立刻校验当前值 */
  validate: (value: string, all: Record<StepKey, string>) => string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 每个 step 的 SVG icon 都绘在 24×24 的 viewBox 中心,用 currentColor 着色
const IconMail = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);

const IconLock = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);


const STEP_VARIANTS = {
  enter: (d: number) => ({ opacity: 0, x: d > 0 ? 40 : -40, scale: 0.97 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (d: number) => ({ opacity: 0, x: d > 0 ? -40 : 40, scale: 0.97 }),
} as const;

/* 登录 ↔ 注册 切换动效:不再用 AnimatePresence + key/popLayout(在该组件下
   exit/enter 不按预期触发,导致切换一直是瞬切、时长参数完全不生效)。
   改为 useAnimationControls 手动驱动同一个常驻 modeShell:
   「先出(淡出+模糊,无位移不晃) → 换内容(displayMode) → 再入(清晰淡入)」。
   时长由 transition 显式指定,确定可控,不依赖任何 key/模式机制。
   详见组件内 controlsSwap effect。 */

const STEP_DEFS: Record<StepKey, StepDef> = {
  email: {
    key: 'email',
    type: 'email',
    placeholder: 'name@example.com',
    label: '邮箱地址',
    buttonText: '继续',
    icon: IconMail,
    bend: 0,
    validate: (v) => (!EMAIL_RE.test(v.trim()) ? '邮箱格式不对' : null),
  },
  password: {
    key: 'password',
    type: 'password',
    placeholder: '至少 8 位字符',
    label: '密码',
    buttonText: '继续',
    icon: IconLock,
    bend: 0,
    validate: (v) => (v.length < 8 ? '密码至少 8 位' : null),
  },
};

function getSteps(mode: 'login' | 'signup'): StepKey[] {
  // Login and signup share the same 2-step path (email → password).
  // P1-8 dropped the old signup-only "confirm password" step: the eye
  // toggle already lets users verify what they typed, so the extra step
  // only added friction. display_name is optional on the backend and is
  // collected later at /me/settings.
  return ['email', 'password'];
}

export default function ImmersiveAuth({
  mode,
  onSubmit,
  onSwitchMode,
  onClose,
  isLoading = false,
  submitError = null,
  onClearSubmitError,
  success = null,
}: ImmersiveAuthProps) {
  // displayMode 是"实际渲染的内容状态",滞后于 props.mode —— 这样切换时
  // "出"动画阶段仍显示旧内容,动画播完才换上新内容,中间无空档、不闪。
  const [displayMode, setDisplayMode] = useState(mode);
  const steps = useMemo(() => getSteps(displayMode), [displayMode]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [data, setData] = useState<Record<StepKey, string>>({
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);

  // 忘记密码子流程:view 在 auth / forgot(填邮箱) / forgot-sent(已发送) 间切换。
  // 复用 modeShell 容器,不额外开路由;重置页本身是独立路由 /reset-password。
  const [view, setView] = useState<'auth' | 'forgot' | 'forgot-sent'>('auth');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDevUrl, setForgotDevUrl] = useState<string | null>(null);

  // 方案②(确定性切换动效):用 useAnimationControls 手动驱动常驻 modeShell。
  // 首次挂载(firstRender)直接对齐 mode,不播动画(与之前 initial={false} 同意图)。
  const controls = useAnimationControls();
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      setDisplayMode(mode);
      return;
    }
    let cancelled = false;
    (async () => {
      // 出:纯模糊 + 淡出,无 y 位移(不晃、不闪)
      await controls.start({
        opacity: 0,
        filter: 'blur(6px)',
        transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1] },
      });
      if (cancelled) return;
      setDisplayMode(mode);
      // 等 React 把新内容渲染完(旧内容此刻仍停在 opacity:0,不可见),
      // 再播"入"动画,避免新内容在满透明度闪一帧。
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      // 入:清晰淡入(同样无位移)
      await controls.start({
        opacity: 1,
        filter: 'blur(0px)',
        transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, controls]);

  // 切换模式时重置 step 状态(等 displayMode 落定后再清,切换瞬间旧内容不闪空)
  useEffect(() => {
    setCurrentIdx(0);
    setDirection(1);
    setData({ email: '', password: '' });
    setError(null);
    // 离开忘记密码子流程,回到登录/注册主表单
    setView('auth');
    setForgotEmail('');
    setForgotError(null);
    setForgotDevUrl(null);
  }, [displayMode]);

  const currentKey = steps[currentIdx];
  const stepDef = STEP_DEFS[currentKey];
  const currentValue = data[currentKey];

  // P1-7: password strength — only on the signup password step.
  // Score = length tiers + character-class diversity, mapped to a
  // 3-segment bar (weak / medium / strong).
  const passwordStrength = useMemo<{ level: number; label: string } | null>(() => {
    if (displayMode !== 'signup' || currentKey !== 'password') return null;
    const v = data.password;
    if (!v) return { level: 0, label: '' };
    let score = 0;
    if (v.length >= 8) score += 1;
    if (v.length >= 12) score += 1;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score += 1;
    if (/\d/.test(v)) score += 1;
    if (/[^A-Za-z0-9]/.test(v)) score += 1;
    const level = Math.min(3, Math.max(1, score));
    const label = level === 1 ? '弱' : level === 2 ? '中' : '强';
    return { level, label };
  }, [displayMode, currentKey, data.password]);

  const handleChange = useCallback(
    (v: string) => {
      setData((prev) => ({ ...prev, [currentKey]: v }));
      if (error) setError(null);
      if (submitError && onClearSubmitError) onClearSubmitError();
    },
    [currentKey, error, submitError, onClearSubmitError]
  );

  const goNext = useCallback(() => {
    const validationError = stepDef.validate(currentValue, data);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    if (currentIdx < steps.length - 1) {
      setDirection(1);
      setCurrentIdx((i) => i + 1);
    } else {
      // 末步:对外提交
      onSubmit({
        email: data.email.trim(),
        password: data.password,
      });
    }
  }, [currentIdx, steps.length, stepDef, currentValue, data, displayMode, onSubmit]);

  const goPrev = useCallback(() => {
    setError(null);
    if (currentIdx > 0) {
      setDirection(-1);
      setCurrentIdx((i) => i - 1);
    }
  }, [currentIdx]);

  const handleForgotSubmit = useCallback(async () => {
    if (!EMAIL_RE.test(forgotEmail.trim())) {
      setForgotError('邮箱格式不对');
      return;
    }
    setForgotError(null);
    setForgotLoading(true);
    try {
      const res = await apiForgotPassword({ email: forgotEmail.trim() });
      setForgotDevUrl(res.dev_reset_url ?? null);
      setView('forgot-sent');
    } catch {
      setForgotError('网络不太通，稍后重试');
    } finally {
      setForgotLoading(false);
    }
  }, [forgotEmail]);

  const backToAuth = useCallback(() => {
    setView('auth');
    setForgotError(null);
    setForgotDevUrl(null);
  }, []);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (isLoading) return;
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
      if (e.key === 'ArrowLeft' && currentIdx > 0) {
        goPrev();
      }
    },
    [isLoading, onClose, currentIdx, goPrev]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return (
    /* Click-outside-to-close is handled by the parent
       <AuthModal>'s <.overlay onClick={close}> (AuthModal.tsx:81).
       The dialog stopProp prevents clicks inside from bubbling.
       So we don't need a second handler here. */
    <div className={styles.shellGrid}>
      {/* ──── 左面板:黑色场景演示 ──── */}
      <aside className={styles.scenePanel} aria-label="为什么选择我们">
        <p className={styles.sceneKicker}>场景示例</p>
        <h2 className={styles.sceneTitle}>听一句，写一句。</h2>
        <p className={styles.sceneSubtitle}>
          4 个真实场景，每句都是你明天会用到的英语。
        </p>

        <div className={styles.sceneList}>
          {SCENES.map((s) => (
            <div key={s.name} className={styles.sceneItem}>
              <span className={styles.sceneEmoji} aria-hidden>{s.emoji}</span>
              <span className={styles.sceneName}>{s.name}</span>
              <span className={styles.sceneEn}>{s.en}</span>
              <span className={styles.sceneZh}>{s.zh}</span>
            </div>
          ))}
        </div>

        <p className={styles.sceneFooter}>
          注册即可开始练习
        </p>
      </aside>

      {/* ──── 右面板:玻璃登录卡 ──── */}
      <div className={`${styles.shell} ${styles.authCard}`}>
        <BorderGlow className={styles.glow} glowRadius={40} glowColor="143, 203, 240" glowIntensity={1.0}>
          <div className={styles.card}>
            {/* P3: 精简版 DriftWall —— 卡片中下部漂浮 3 张词汇词卡
               (SCENES 的 name/en),mask 顶部/底部淡出,opacity 0.34,
               纯装饰不挡表单。给玻璃卡一点"活气"。 */}
            <DriftWall items={SCENES.map((s) => ({ name: s.name, en: s.en }))} />
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                title="关闭"
                className={styles.closeBtn}
              >
                <svg
                  className={styles.closeIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}

            {/* 左上角返回箭头 —— 与右上角关闭按钮对称。
               多步可退(auth 视图)或忘记密码子流程中显示;
               不再占底部操作区,下方只留"忘记密码"与主按钮。 */}
            {(view !== 'auth' || currentIdx > 0) && (
              <button
                type="button"
                onClick={view !== 'auth' ? backToAuth : goPrev}
                disabled={isLoading}
                aria-label={view !== 'auth' ? '返回登录' : '上一步'}
                title={view !== 'auth' ? '返回登录' : '上一步'}
                className={styles.cornerBack}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>{view !== 'auth' ? '返回' : '上一步'}</span>
              </button>
            )}

            {/* 切换动效容器:常驻单个 motion.div,由 useAnimationControls
               手动驱动(见组件内 controlsSwap effect)。打开 modal 时
               initial 即终态、不播动画。DriftWall 与关闭按钮留在外层,
               不随切换重挂/动画。 */}
            <motion.div
              className={styles.modeShell}
              animate={controls}
              initial={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            >
            {view === 'auth' && (
            <>
            <div className={styles.header}>
              {/* ME-Q6: dropped the "01 / 02" progress counter —
                  it was floating in the top-right with no visual
                  anchor and redundant with the eyebrow below. The
                  eyebrow + title + input area are enough to orient
                  the user. */}
              <div className={styles.eyebrowRow}>
                <span className={styles.eyebrow}>{displayMode === 'signup' ? "创建学习账号 · 30 秒" : "欢迎回来"}</span>
                <ol className={styles.progress} aria-label="Progress" data-testid="auth-progress">
                  {steps.map((_, i) => (
                    <li
                      key={i}
                      className={styles.progressDot + " " + (i < currentIdx ? styles.progressDotDone : i === currentIdx ? styles.progressDotActive : styles.progressDotFuture)}
                      aria-current={i === currentIdx ? "step" : undefined}
                    />
                  ))}
                </ol>
                <span className={styles.srOnly} aria-live="polite">
                  第 {currentIdx + 1} 步, 共 {steps.length} 步
                </span>
              </div>
              <h2 className={styles.title}>
                {displayMode === 'signup' ? '注册' : '登录'}
              </h2>
              <p className={styles.subtitle}>用真实场景练习外语口语</p>
            </div>

            <div className={styles.content}>
              <div className={styles.stage}>
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                  {success ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                      className={styles.successOverlay}
                      data-testid="auth-success"
                    >
                      <svg className={styles.successCircle} viewBox="0 0 56 56" fill="none" aria-hidden="true">
                        <circle cx="28" cy="28" r="26" className={styles.successCircleRing} />
                        <path d="M16 29 L25 38 L41 21" className={styles.successCheck} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <p className={styles.successTitle}>欢迎！</p>
                      <p className={styles.successSubtitle}>账号 {success.email} 已创建</p>
                    </motion.div>
                  ) : (
                  <motion.div
                    key={currentKey}
                    custom={direction}
                    variants={STEP_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                    className={styles.step}
                  >
                    <CurvedInput
                      value={currentValue}
                      onChange={handleChange}
                      onSubmit={goNext}
                      placeholder={stepDef.placeholder}
                      label={stepDef.label}
                      /* 5. Button text switches to "处理中..." when
                         the form is submitting — gives the user
                         a visible sign that the click registered
                         and the network request is in flight
                         (otherwise the button just goes disabled
                         with no feedback). */
                      buttonText={isLoading ? '处理中...' : stepDef.buttonText}
                      type={stepDef.type}
                      name={currentKey}
                      icon={stepDef.icon}
                      bend={stepDef.bend}
                      showEye={stepDef.type === 'password'}
                      width="100%"
                      height={68}
                      fontSize={17}
                      cornerRadius={20}
                      borderWidth={1.5}
                      shadowSize="lg"
                      theme="light"
                      showButton
                      showIcon
                      /* 继续按钮颜色对齐 landing 页"注册"CTA:都用品牌蓝
                         --ds-action-deep(浅色主题 = #2F80C0)。这里不能用
                         var(--ds-action-deep) 直接传,因为 SVG 的 fill 呈现
                         属性对 CSS 变量解析不稳定,用其解析后的 hex 等价。 */
                      buttonColor="#2F80C0"
                      /* 整卡随 mode 重挂时,自动把光标落回输入框
                         (登录↔注册切换、email→password 步进都受益)。 */
                      autoFocus
                      disabled={isLoading}
                      /* CurvedInput's `loading` prop adds a spinner
                         overlay on the button (in addition to
                         disabled). 5b. */
                      loading={isLoading}
                    />
                  </motion.div>
                  )}
                </AnimatePresence>

                <div className={styles.feedbackRow}>
                  <AnimatePresence>
                    {(submitError || error) && (
                      <motion.span
                        key={submitError || error}
                        role="alert"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className={styles.error}
                      >
                        {submitError || error}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                {passwordStrength && (
                  <div className={styles.strength}>
                    <div className={styles.strengthBars} aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className={`${styles.strengthBar} ${i < passwordStrength.level ? styles.strengthBarOn : ''}`}
                          data-level={passwordStrength.level}
                        />
                      ))}
                    </div>
                    {passwordStrength.label ? (
                      <span className={styles.strengthLabel} data-level={passwordStrength.level}>
                        {passwordStrength.label}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              <div className={styles.hintRow}>
                <span className={styles.hint}>{currentIdx === steps.length - 1 ? "按回车完成" : "按回车继续"}</span>
              </div>

              {/* 忘记密码 —— 仅登录态的密码步显示,右对齐幽灵链接。
                 "上一步"已移至左上角 .cornerBack,底部不再放返回按钮,
                 只保留这枚次要逃生出口,操作区更干净。 */}
              {currentKey === 'password' && displayMode === 'login' && (
                <div className={styles.navRow}>
                  <button
                    type="button"
                    className={styles.forgotBtn}
                    onClick={() => setView('forgot')}
                  >
                    忘记密码？
                  </button>
                </div>
              )}
            </div>

            <div className={styles.footer}>
              <button
                type="button"
                onClick={onSwitchMode}
                className={styles.switchBtn}
              >
                {displayMode === 'signup' ? '已有账号？直接登录' : '新用户？立即注册'}
              </button>
            </div>

            {/* P3: 法律声明落在白色卡片内、卡片底部(而非卡片外的暗色 scrim 上)。
               这样它属于 modal 框内部,既居中又不会"飘在框外下方"。文本用
               卡片主题的低对比 ink,链接用 action-deep。 */}
            <p className={styles.cardLegal}>
              继续即代表同意
              <a href="/terms" target="_blank" rel="noopener noreferrer">服务条款</a>
              {' · '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a>
            </p>
            </>
            )}
            {view !== 'auth' && (
              <div className={styles.forgotWrap}>
                {view === 'forgot' ? (
                  <>
                    <div className={styles.header}>
                      <div className={styles.eyebrowRow}>
                        <span className={styles.eyebrow}>重置密码</span>
                      </div>
                      <h2 className={styles.title}>忘记密码？</h2>
                      <p className={styles.subtitle}>输入你的注册邮箱，我们会发送重置链接</p>
                    </div>
                    <div className={styles.content}>
                      <div className={styles.stage}>
                        <CurvedInput
                          value={forgotEmail}
                          onChange={setForgotEmail}
                          onSubmit={handleForgotSubmit}
                          placeholder="name@example.com"
                          label="邮箱地址"
                          buttonText={forgotLoading ? '处理中...' : '发送重置链接'}
                          type="email"
                          name="forgot-email"
                          icon={IconMail}
                          bend={0}
                          width="100%"
                          height={68}
                          fontSize={17}
                          cornerRadius={20}
                          borderWidth={1.5}
                          shadowSize="lg"
                          theme="light"
                          showButton
                          showIcon
                          buttonColor="#2F80C0"
                          autoFocus
                          disabled={forgotLoading}
                          loading={forgotLoading}
                        />
                        <div className={styles.feedbackRow}>
                          <AnimatePresence>
                            {forgotError && (
                              <motion.span
                                role="alert"
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.18 }}
                                className={styles.error}
                              >
                                {forgotError}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                      {/* 返回登录已移至左上角 .cornerBack */}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.header}>
                      <div className={styles.eyebrowRow}>
                        <span className={styles.eyebrow}>已发送</span>
                      </div>
                      <h2 className={styles.title}>查收邮件</h2>
                      <p className={styles.subtitle}>我们已向 {forgotEmail} 发送重置邮件，点击邮件中的链接设置新密码。</p>
                    </div>
                    <div className={styles.content}>
                      <div className={styles.stage}>
                        {forgotDevUrl ? (
                          <a className={styles.devResetLink} href={forgotDevUrl} target="_blank" rel="noopener noreferrer">
                            开发模式：直接打开重置页
                          </a>
                        ) : null}
                      </div>
                      {/* 返回登录已移至左上角 .cornerBack */}
                    </div>
                  </>
                )}
              </div>
            )}
            </motion.div>
          </div>
        </BorderGlow>
      </div>
    </div>
  );
}
