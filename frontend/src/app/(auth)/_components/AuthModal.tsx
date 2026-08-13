'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuthModal } from '../../lib/authModal';
import { useAuth } from '../../lib/auth';
import { safeRedirectPath } from '../../lib/safeRedirect';
import ImmersiveAuth from './ImmersiveAuth';
import { apiLogin, apiSignup, ApiError } from '../../api';
import styles from './AuthModal.module.css';

export default function AuthModal() {
  const { state, close, setMode } = useAuthModal();
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // createPortal 需要 document.body，仅客户端可用
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  if (!state.open) return null;

  return createPortal(
    <AuthModalBody
      state={state}
      close={close}
      setMode={setMode}
      isLoading={isLoading}
      setIsLoading={setIsLoading}
    />,
    document.body
  );
}

interface AuthModalBodyProps {
  state: { open: boolean; mode: 'login' | 'signup'; from: string | null };
  close: () => void;
  setMode: (mode: 'login' | 'signup') => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

function AuthModalBody({ state, close, setMode, isLoading, setIsLoading }: AuthModalBodyProps) {
  const router = useRouter();
  const { refresh } = useAuth();
  const handleSubmit = useCallback(async (data: { email?: string; password?: string; name?: string }) => {
    setIsLoading(true);
    try {
      if (state.mode === 'login') {
        await apiLogin({ email: data.email!, password: data.password! });
      } else {
        await apiSignup({
          email: data.email!,
          password: data.password!,
          display_name: data.name,
        });
      }
      // 刷新 auth context 让 useAuth() 拿到新 user，再关 modal。
      // 避免任何依赖 user 状态的子树（header 头像、dashboard 守卫等）出现 flicker。
      await refresh();
      // close modal 前先 navigate 到 state.from(/me?from=/me 等被守卫挡回的场景)。
      // safeRedirectPath 兜底非法 ?from= 值(协议相对 URL / 控制字符 / 太长等),
      // 无 from 时落到 /dashboard(登录后默认落脚)。
      const target = safeRedirectPath(state.from, "/dashboard");
      router.replace(target);
      close();
    } catch (error) {
      console.error('Auth failed:', error);
      if (error instanceof ApiError) {
        alert(`${state.mode === 'login' ? '登录失败' : '注册失败'}：${error.message}`);
      } else if (error instanceof Error) {
        alert(`${state.mode === 'login' ? '登录失败' : '注册失败'}：${error.message || '网络错误，请检查连接'}`);
      } else {
        alert(state.mode === 'login' ? '登录失败' : '注册失败');
      }
    } finally {
      setIsLoading(false);
    }
  }, [state.mode, setIsLoading, refresh, close, router]);

  const handleSwitchMode = useCallback(() => {
    setMode(state.mode === 'login' ? 'signup' : 'login');
  }, [state.mode, setMode]);

  return (
    <div className={styles.overlay} onClick={close}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <ImmersiveAuth
          mode={state.mode}
          onSubmit={handleSubmit}
          onSwitchMode={handleSwitchMode}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
