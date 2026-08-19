'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthModal } from '../../lib/authModal';
import { safeRedirectPath } from '../../lib/safeRedirect';

export default function LoginPage() {
  /* useSearchParams() 在 Next.js 15 prerender 必须包 Suspense boundary。
     整页路由触发 modal + replace,SearchParams 仅用于读 from 状态,
     包 Suspense 后 fallback 是空 — 客户端 hydrate 后立刻 trigger modal。 */
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
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
