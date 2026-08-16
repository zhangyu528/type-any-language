'use client';

/**
 * Toast — 极轻量全局提示。
 *
 * 仅用在本项目的"轻反馈"场景：选课/退课成功、可撤销的操作等。
 * 与 dashboard 既有 glass 美学一致（底部居中胶囊 + 模糊 + 描边）。
 *
 * 用法：
 *   <ToastProvider> 包裹应用（dashboard 已在最外层包好）。
 *   在消费组件里 const { show } = useToast();
 *   show({ message: '已加入我的课程' });
 *   show({ message: '已移除《X》', actionLabel: '撤销', onAction: () => {...} });
 *
 * 不依赖任何 UI 框架；动画走 CSS keyframes（含 reduced-motion 兜底）。
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './Toast.module.css';

export interface ToastOptions {
  /** 主文案。 */
  message: string;
  /** 可选操作按钮文案（如"撤销"）。 */
  actionLabel?: string;
  /** 点击操作按钮时回调（点击后会自动关闭该 toast）。 */
  onAction?: () => void;
  /** 自动关闭毫秒数；0 表示常驻直到手动关闭（默认 3200）。 */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  leaving?: boolean;
}

interface ToastApi {
  show: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      // 先标记离场（触发淡出），动画结束再真正移除。
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      window.setTimeout(() => remove(id), 180);
    },
    [remove],
  );

  const show = useCallback(
    (opts: ToastOptions) => {
      const id = ++idRef.current;
      const duration = opts.duration ?? 3200;
      setToasts((list) => [...list, { ...opts, id }]);
      if (duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className={styles.viewport} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${t.leaving ? styles.leaving : ''}`}
          >
            <span className={styles.msg}>{t.message}</span>
            {t.actionLabel ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
