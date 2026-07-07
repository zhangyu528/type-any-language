'use client';

/**
 * /signup — email + password + display_name registration.
 *
 * Mirrors the login form layout. Pydantic on the backend enforces
 * password length (8-72) and email format, but we also client-validate
 * for better UX.
 */
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { apiSignup } from '../../api';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiSignup({
        email: email.trim(),
        password,
        display_name: displayName.trim(),
      });
      router.replace('/history');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="auth-form" noValidate>
      <h1>注册</h1>

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
        <span className="auth-field__label">显示名</span>
        <input
          type="text"
          autoComplete="nickname"
          required
          minLength={1}
          maxLength={50}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="auth-field__input"
        />
      </label>

      <label className="auth-field">
        <span className="auth-field__label">密码 (8-72 位)</span>
        <input
          type="password"
          autoComplete="new-password"
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
        {submitting ? '注册中…' : '注册'}
      </button>

      <p className="auth-form__alt">
        已经有账号？<Link href="/login">登录</Link>
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