'use client';

import { Suspense, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ImmersiveAuth from '../_components/ImmersiveAuth';
import styles from '../_components/AuthModal.module.css';
import { apiLogin, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';
import { safeRedirectPath } from '../../lib/safeRedirect';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = useCallback(
    async (data: { email?: string; password?: string; name?: string }) => {
      setIsLoading(true);
      try {
        await apiLogin({ email: data.email!, password: data.password! });
        // 关键：登录成功后先 refresh() 把 useAuth context 里的 user 同步上，
        // 否则后续 /dashboard 守卫会因 user=null 立刻把用户踢回 /login。
        await refresh();
        const target = safeRedirectPath(searchParams.get('from'), '/dashboard');
        router.replace(target);
      } catch (error) {
        if (error instanceof ApiError) {
          alert(`登录失败：${error.message}`);
        } else if (error instanceof Error) {
          alert(`登录失败：${error.message || '网络错误，请检查连接'}`);
        } else {
          alert('登录失败，请稍后重试');
        }
        console.error('Login failed:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [router, searchParams, refresh]
  );

  const handleSwitchMode = useCallback(() => {
    const from = searchParams.get('from');
    const qs = from ? `?from=${encodeURIComponent(from)}` : '';
    router.push(`/signup${qs}`);
  }, [router, searchParams]);

  const handleClose = useCallback(() => {
    // X / Escape = 一键离开认证流程,直接去 landing。
    //
    // ❌ 不要"尊重 `from` —— from 是受保护路由,user=null 时那个路由
    //   的 auth guard 会把用户推回 /login,形成 /login → from → /login
    //   的死循环(用户登出后永远卡在这里)。
    // ❌ 不要 router.back() —— login↔signup 切换会留 breadcrumb 痕迹,
    //   后退可能回到上一个 auth 子页面而不是 landing。
    router.push('/');
  }, [router]);

  return (
    /* v9: wrap ImmersiveAuth in a local .overlay (re-using the
       same class names as <AuthModal>). The /login page used
       to render <ImmersiveAuth> directly with no scrim, so
       clicking outside the cards did nothing — there was no
       element to receive the click. The previous click-outside
       handler lived in <AuthModal> but that path is only used
       for hero/landing modal triggers, not for the /me →
       /login redirect path. */
    <div
      className={styles.overlay}
      onClick={handleClose}
      role="presentation"
    >
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
      >
        <ImmersiveAuth
          mode="login"
          onSubmit={handleSubmit}
          onSwitchMode={handleSwitchMode}
          onClose={handleClose}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}