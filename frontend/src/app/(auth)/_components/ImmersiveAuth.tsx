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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CurvedInput } from '@/components/effects';
import { TiltCard } from '@/components/effects/tilt-card';
import { GlowCard } from '@/components/effects/glow-card';
import { DriftWall } from './DriftWall';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
}

type StepKey = 'name' | 'email' | 'password';

interface StepDef {
  key: StepKey;
  type: string;
  placeholder: string;
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

const IconUser = (
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
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
  </svg>
);

const STEP_VARIANTS = {
  enter: (d: number) => ({ opacity: 0, x: d > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d > 0 ? -40 : 40 }),
} as const;

const STEP_DEFS: Record<StepKey, StepDef> = {
  name: {
    key: 'name',
    type: 'text',
    placeholder: '您的姓名',
    buttonText: '继续',
    icon: IconUser,
    bend: 0,
    validate: (v) => (v.trim().length === 0 ? '请填写姓名' : null),
  },
  email: {
    key: 'email',
    type: 'email',
    placeholder: 'name@example.com',
    buttonText: '继续',
    icon: IconMail,
    bend: 0,
    validate: (v) => (!EMAIL_RE.test(v.trim()) ? '邮箱格式不对' : null),
  },
  password: {
    key: 'password',
    type: 'password',
    placeholder: '至少 8 位字符',
    buttonText: '完成',
    icon: IconLock,
    bend: 0,
    validate: (v) => (v.length < 8 ? '密码至少 8 位' : null),
  },
};

function getSteps(mode: 'login' | 'signup'): StepKey[] {
  return mode === 'signup' ? ['name', 'email', 'password'] : ['email', 'password'];
}

export default function ImmersiveAuth({
  mode,
  onSubmit,
  onSwitchMode,
  onClose,
  isLoading = false,
}: ImmersiveAuthProps) {
  const steps = useMemo(() => getSteps(mode), [mode]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [data, setData] = useState<Record<StepKey, string>>({
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);

  // 切换模式时重置 step 状态
  useEffect(() => {
    setCurrentIdx(0);
    setDirection(1);
    setData({ name: '', email: '', password: '' });
    setError(null);
  }, [mode]);

  const currentKey = steps[currentIdx];
  const stepDef = STEP_DEFS[currentKey];
  const currentValue = data[currentKey];

  const handleChange = useCallback(
    (v: string) => {
      setData((prev) => ({ ...prev, [currentKey]: v }));
      if (error) setError(null);
    },
    [currentKey, error]
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
        ...(mode === 'signup' ? { name: data.name.trim() } : {}),
      });
    }
  }, [currentIdx, steps.length, stepDef, currentValue, data, mode, onSubmit]);

  const goPrev = useCallback(() => {
    setError(null);
    if (currentIdx > 0) {
      setDirection(-1);
      setCurrentIdx((i) => i - 1);
    }
  }, [currentIdx]);

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
      <TiltCard className={`${styles.shell} ${styles.authCard}`} maxTilt={0} scale={1}>
        <GlowCard className={styles.glow} glowSize={360}>
          <Card className={styles.card}>
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

            <CardHeader className={styles.header}>
              {/* ME-Q6: dropped the "01 / 02" progress counter —
                  it was floating in the top-right with no visual
                  anchor and redundant with the eyebrow below. The
                  eyebrow + title + input area are enough to orient
                  the user. */}
              <span className={styles.eyebrow}>Type Any Language</span>
              <CardTitle className={styles.title}>
                {mode === 'signup' ? '注册' : '登录'}
              </CardTitle>
              <p className={styles.subtitle}>用真实场景练习外语口语</p>
            </CardHeader>

            <CardContent className={styles.content}>
              <div className={styles.stage}>
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                  <motion.div
                    key={`${mode}-${currentKey}`}
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
                      width="100%"
                      height={68}
                      fontSize={17}
                      cornerRadius={20}
                      borderWidth={1.5}
                      shadowSize="lg"
                      theme="light"
                      showButton
                      showIcon
                      disabled={isLoading}
                      /* CurvedInput's `loading` prop adds a spinner
                         overlay on the button (in addition to
                         disabled). 5b. */
                      loading={isLoading}
                    />
                  </motion.div>
                </AnimatePresence>

                <div className={styles.feedbackRow}>
                  <AnimatePresence>
                    {error && (
                      <motion.span
                        key={error}
                        role="alert"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className={styles.error}
                      >
                        {error}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className={styles.hintRow}>
                <span className={styles.hint}>按回车继续</span>
              </div>

              {/* DriftWall text cards fill the blank between hint and register link */}
              <DriftWall items={SCENES.map((s) => ({ name: s.name, en: s.en }))} />

              {(currentIdx > 0 || (currentKey === 'password' && mode === 'login')) && (
                <div className={styles.navRow}>
                  <button
                    type="button"
                    onClick={goPrev}
                    disabled={currentIdx === 0 || isLoading}
                    className={`${styles.backBtn} ${
                      currentIdx === 0 ? styles.backBtnHidden : ''
                    }`}
                    aria-label="上一步"
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
                      className={styles.backIcon}
                    >
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    <span>上一步</span>
                  </button>

                  {/* 1. Forgot password — only on the password step
                     in login mode. Right-aligned, ghost text-link. */}
                  {currentKey === 'password' && mode === 'login' ? (
                    <button
                      type="button"
                      className={styles.forgotBtn}
                      onClick={() => {
                        // TODO: wire to /forgot-password when
                        // implemented. For now this is a
                        // functional surface only.
                        window.location.href = '/forgot-password';
                      }}
                    >
                      忘记密码？
                    </button>
                  ) : null}
                </div>
              )}
            </CardContent>

            <div className={styles.footer}>
              <button
                type="button"
                onClick={onSwitchMode}
                className={styles.switchBtn}
              >
                {mode === 'signup' ? '已有账号？直接登录' : '新用户？立即注册'}
              </button>
            </div>
          </Card>
        </GlowCard>
      </TiltCard>
    </div>
  );
}
