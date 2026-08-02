/**
 * TAL Mint · Design System — motion 预设(motion v12 / framer)
 *
 * Q 弹是性格:交互反馈用 spring.overshoot(软回弹);
 * 幕间滚动用 spring.soft(不越界);计数器用 spring.counter。
 * reduced-motion 统一降级:SPRING_REDUCED + 透明度淡入。
 *
 * 断点与 tokens.css 注释保持一致:640 / 1024。
 */

export const breakpoints = { sm: 640, lg: 1024 } as const;

export const duration = {
  instant: 0.08,
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

export const easing = {
  out: [0.16, 1, 0.3, 1] as const,
  springCss: [0.34, 1.56, 0.64, 1] as const,
};

export const spring = {
  /** Q 弹 —— 卡片入场、按钮回弹、气泡浮起 */
  overshoot: { type: 'spring', stiffness: 260, damping: 20 } as const,
  /** 柔和 —— 幕间滚动 reveal,不越界 */
  soft: { type: 'spring', stiffness: 120, damping: 24 } as const,
  /** 数字 —— 统计/计数翻滚 */
  counter: { type: 'spring', stiffness: 300, damping: 30 } as const,
  /** 降级 —— prefers-reduced-motion */
  reduced: { type: 'tween', duration: 0.15, ease: 'easeOut' } as const,
};

/** 通用入场 variants:上浮 12px + 淡入(Q 弹) */
export const riseIn = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
} as const;

/** 通用 stagger:父容器挂这个,子元素挂 riseIn */
export const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
} as const;
