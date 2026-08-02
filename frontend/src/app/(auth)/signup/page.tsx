'use client';

/**
 * /signup — 单页完整注册表单。
 *
 * 状态/校验/提交逻辑全部在 useAuthFormState hook 里,
 * /login page 与 AuthModal 共用同一份 hook — 本文件只剩 Suspense
 * shell、<h1> 4 字 stagger、AuthForm 渲染。
 *
 * 保留行为:
 *   - useSearchParams + safeRedirectPath 处理 ?from= 回跳
 *   - 409 "该邮箱已注册"挂 errors.email (hook 内)
 *   - 密码端至少 8 位, 两次需相等 (hook 内)
 *   - 实时匹配 hint(✓/⚠) (hook 内 useMemo)
 *   - 服务端 fieldErrors → 对应字段聚焦 (hook 内 useEffect)
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { safeRedirectPath } from '../../lib/safeRedirect';
import { useAuthFormState } from '../_hooks/useAuthFormState';
import AuthForm from '../_components/AuthForm';

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-card">
          <p className="auth-form__loader">Loading…</p>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams?.get('from') ?? null;
  const redirectTo = safeRedirectPath(fromParam, '/');

  const { formProps, formRef, submit } = useAuthFormState({
    mode: 'signup',
    redirectTo,
  });

  const handleSubmit = useCallback(async () => {
    const ok = await submit();
    if (ok) router.replace(redirectTo);
  }, [submit, redirectTo, router]);

  return (
    <>
      <h1 className="auth-title">
        {Array.from('创建账号').map((char, i) => (
          <span
            key={i}
            className="auth-title__char"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            {char}
          </span>
        ))}
      </h1>
      <AuthForm ref={formRef} {...formProps} onSubmit={handleSubmit} />
    </>
  );
}
