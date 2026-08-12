/**
 * (auth) route group layout — Aurora background.
 *
 * 设计意图: auth 是"进入私密空间"的仪式，视觉语言与全站一致。
 * 背景使用 Aurora 极光动画。
 *
 * 左右各保留 100px（所有屏幕统一规则，含手机）。
 *
 * ImmersiveAuth 组件已经包含完整的卡片样式，不需要 layout 再包一层。
 */
import type { ReactNode } from 'react';
import Aurora from '@/components/Aurora';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell" data-babyblue>
      {/* Aurora background — flowing light curtains */}
      <Aurora className="fixed inset-0 z-0" />

      {children}

      <style dangerouslySetInnerHTML={{ __html: `
        .auth-shell {
          position: relative;
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6) 100px;
          overflow: hidden;
          background: var(--ds-bg);
        }
      `}} />
    </main>
  );
}
