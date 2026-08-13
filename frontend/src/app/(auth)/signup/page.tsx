'use client';

/**
 * /signup — 触发 AuthModal(全站唯一注册 UI)。
 *
 * 同 /login:本页只触发 open('signup', { from }) + replace('/')。
 * 详见 /login/page.tsx 注释。
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthModal } from '../../lib/authModal';
import { safeRedirectPath } from '../../lib/safeRedirect';

export default function SignupPage() {
  return <SignupInner />;
}

function SignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { open } = useAuthModal();

  useEffect(() => {
    const from = searchParams.get('from');
    open('signup', { from: from ?? undefined });
    router.replace('/');
  }, []);

  return null;
}
