'use client';

/**
 * /login — 单页完整登录表单。
 *
 * 状态/校验/提交逻辑全部在 useAuthFormState hook 里,
 * /signup page 与 AuthModal 共用同一份 hook — 本文件只剩 Suspense
 * shell、<h1> 4 字 stagger、AuthForm 渲染。
 *
 * 保留行为:
 *   - useSearchParams + safeRedirectPath 处理 ?from= 回跳
 *   - 邮箱最小格式校验 (hook 内)
 *   - 服务端 fieldErrors → 对应字段聚焦 (hook 内 useEffect)
 *   - 网络错误 fallback: 「网络异常,请稍后重试」 (hook 内)
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { safeRedirectPath } from '../../lib/safeRedirect';
import { useAuthFormState } from '../_hooks/useAuthFormState';
import AuthForm from '../_components/AuthForm';

/**
 * Suspense shell — required by Next.js 14 for any page that calls
 * useSearchParams(). The fallback renders the same auth-card surface so
 * there's no flash between hydration and the form appearing.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-card">
          <p className="auth-form__loader">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // safeRedirectPath() defends against open-redirect attacks (e.g.
  // /login?from=https://evil.com). When absent or invalid, '/' kicks in.
  const fromParam = searchParams?.get('from') ?? null;
  const redirectTo = safeRedirectPath(fromParam, '/');

  const { formProps, formRef, submit } = useAuthFormState({
    mode: 'login',
    redirectTo,
  });

  const handleSubmit = useCallback(async () => {
    const ok = await submit();
    if (ok) router.replace(redirectTo);
  }, [submit, redirectTo, router]);

  return (
    <>
      <h1 className="auth-title">
        {Array.from('欢迎回来').map((char, i) => (
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
