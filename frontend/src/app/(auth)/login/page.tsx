'use client';

/**
 * /login — email + password sign-in.
 *
 * On success, redirects to /history (the protected page that proves
 * the auth cookie works end-to-end). Errors are surfaced inline as
 * a single line under the form (no banners, no alerts — Apple HIG
 * "quiet" feedback).
 */
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { apiLogin } from '../../api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiLogin({ email: email.trim(), password });
      router.replace('/history');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="auth-form" noValidate>
      <h1>登录到 Type Any Language</h1>

      <label className="auth-field">
        <span className="auth-field__label">邮箱</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="auth-field__input"
        />
      </label>

      <label className="auth-field">
        <span className="auth-field__label">密码</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={72}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="auth-field__input"
        />
      </label>

      {error ? <p className="auth-form__error">{error}</p> : null}

      <button type="submit" disabled={submitting} className="auth-form__submit">
        {submitting ? '登录中…' : '登录'}
      </button>

      <p className="auth-form__alt">
        还没有账号？<Link href="/signup">注册</Link>
      </p>

      <style>{`
        .auth-form { display: flex; flex-direction: column; gap: var(--space-4); }
        .auth-field { display: flex; flex-direction: column; gap: var(--space-2); }
        .auth-field__label {
          font-size: var(--type-caption);
          color: var(--label-tertiary);
        }
        .auth-field__input {
          height: 40px;
          padding: 0 var(--space-3);
          font-family: inherit;
          font-size: var(--type-body);
          color: var(--label-primary);
          background: var(--surface);
          border: 1px solid var(--separator-opaque);
          border-radius: var(--radius-sm);
        }
        .auth-field__input:focus { outline: 2px solid var(--label-primary); outline-offset: 2px; }
        .auth-form__error {
          font-size: var(--type-caption);
          color: var(--label-secondary);
          margin: 0;
        }
        .auth-form__submit {
          height: 44px;
          margin-top: var(--space-2);
          font-family: inherit;
          font-size: var(--type-body);
          font-weight: var(--type-body-emphasis-weight);
          color: var(--surface);
          background: var(--label-primary);
          border: 0;
          border-radius: var(--radius-md);
          cursor: pointer;
        }
        .auth-form__submit:disabled { opacity: 0.5; cursor: progress; }
        .auth-form__alt {
          text-align: center;
          font-size: var(--type-caption);
          color: var(--label-tertiary);
          margin-top: var(--space-3);
        }
        .auth-form__alt a { color: var(--label-primary); text-decoration: none; }
        .auth-form__alt a:hover { text-decoration: underline; }
      `}</style>
    </form>
  );
}