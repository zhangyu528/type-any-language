'use client';

import { Suspense, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ImmersiveAuth from '../_components/ImmersiveAuth';
import { apiSignup, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';
import { safeRedirectPath } from '../../lib/safeRedirect';

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = useCallback(
    async (data: { email?: string; password?: string; name?: string }) => {
      setIsLoading(true);
      try {
        await apiSignup({
          email: data.email!,
          password: data.password!,
          display_name: data.name,
        });
        // 同 login：注册成功 → refresh() → navigate
        await refresh();
        const target = safeRedirectPath(searchParams.get('from'), '/dashboard');
        router.replace(target);
      } catch (error) {
        if (error instanceof ApiError) {
          alert(`注册失败：${error.message}`);
        } else if (error instanceof Error) {
          alert(`注册失败：${error.message || '网络错误，请检查连接'}`);
        } else {
          alert('注册失败，请稍后重试');
        }
        console.error('Signup failed:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [router, searchParams, refresh]
  );

  const handleSwitchMode = useCallback(() => {
    const from = searchParams.get('from');
    const qs = from ? `?from=${encodeURIComponent(from)}` : '';
    router.push(`/login${qs}`);
  }, [router, searchParams]);

  const handleClose = useCallback(() => {
    // X / Escape = 一键离开认证流程,直接去 landing。
    //
    // ❌ 不要"尊重 `from` —— from 是受保护路由,user=null 时那个路由
    //   的 auth guard 会把用户推回 /signup,形成 /signup → from → /signup
    //   的死循环(用户登出后永远卡在这里)。
    // ❌ 不要 router.back() —— login↔signup 切换会留 breadcrumb 痕迹。
    router.push('/');
  }, [router]);

  return (
    <ImmersiveAuth
      mode="signup"
      onSubmit={handleSubmit}
      onSwitchMode={handleSwitchMode}
      onClose={handleClose}
      isLoading={isLoading}
    />
  );
}