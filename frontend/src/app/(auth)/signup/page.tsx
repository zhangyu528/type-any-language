'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthModal } from '../../lib/authModal';
import { safeRedirectPath } from '../../lib/safeRedirect';

export default function SignupPage() {
  /* useSearchParams() 在 Next.js 15 prerender 必须包 Suspense boundary。
     触发 modal 后立刻 replace,Suspense fallback 是空。 */
  return (
    <Suspense fallback={null}>
      <SignupInner />
    </Suspense>
  );
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
