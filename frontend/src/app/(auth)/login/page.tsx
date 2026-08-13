'use client';

/**
 * /login — 触发 AuthModal(全站唯一登录 UI)。
 *
 * 之前:整页路由,自己渲染 <ImmersiveAuth> + .overlay 假装 modal 视觉。
 *       用户直访 /login 或被 /me 守卫重定向到这里时,看到的是"伪 modal 页"。
 * 现在:本页只触发 AuthModalProvider.open('login', { from }),然后
 *       router.replace('/') 把 URL 抹掉 —— 用户留在 home,modal 盖在 home 上,
 *       跟 AppHeader 点"登录"按钮是完全一样的体验(单一 modal 入口)。
 *       state.from 传给 modal,modal 成功后用 safeRedirectPath 跳转。
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthModal } from '../../lib/authModal';
import { safeRedirectPath } from '../../lib/safeRedirect';

export default function LoginPage() {
  return <LoginInner />;
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { open } = useAuthModal();

  useEffect(() => {
    const from = searchParams.get('from');
    /* open() 同时设置 state.from + state.mode='login' —— AuthModal 渲染时读这俩 */
    open('login', { from: from ?? undefined });
    /* 把 URL 抹成 home:用户感知不到 /login 这层路由,直接回到 landing */
    router.replace('/');
    /* 这里返回 null —— modal 已经在 document.body 上,不在本页子树 */
  }, []); /* 只在 mount 触发一次 */

  return null;
}
