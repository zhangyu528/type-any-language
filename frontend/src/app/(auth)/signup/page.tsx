'use client';

/**
 * /signup — email + password + display_name registration.
 *
 * Same refresh-then-navigate pattern as login. See KNOWN_ISSUES.md §4.4.
 */
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { apiSignup } from '../../api';
import { useAuth } from '../../lib/auth';

export default function SignupPage() {
  const router = useRouter();
  const { refresh } = useAuth();
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
      await refresh();
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
          letter-spacing: 0.02em;
        }
        .auth-field__input {
          height: 44px;
          padding: 0 var(--space-4);
          font-family: inherit;
          font-size: var(--type-body);
          color: var(--label-primary);
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: var(--radius-sm);
          transition: background var(--duration-fast) var(--ease-standard),
                      border-color var(--duration-fast) var(--ease-standard);
        }
        .auth-field__input::placeholder { color: var(--label-quaternary); }
        .auth-field__input:hover {
          background: rgba(255, 255, 255, 0.85);
          border-color: rgba(0, 0, 0, 0.12);
        }
        .auth-field__input:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.95);
          border-color: var(--label-primary);
          box-shadow: 0 0 0 3px rgba(28, 28, 30, 0.08);
        }
        .auth-form__error {
          font-size: var(--type-caption);
          color: var(--accent);
          margin: 0;
        }
        .auth-form__submit {
          height: 48px;
          margin-top: var(--space-2);
          font-family: inherit;
          font-size: var(--type-body);
          font-weight: var(--type-body-emphasis-weight);
          color: var(--surface);
          background: linear-gradient(180deg, #2C2C2E 0%, #1C1C1E 100%);
          border: 0;
          border-radius: var(--radius-md);
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
          transition: transform var(--duration-fast) var(--ease-standard),
                      box-shadow var(--duration-fast) var(--ease-standard);
        }
        .auth-form__submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
        }
        .auth-form__submit:active:not(:disabled) { transform: translateY(0); }
        .auth-form__submit:disabled { opacity: 0.5; cursor: progress; }
        .auth-form__alt {
          text-align: center;
          font-size: var(--type-caption);
          color: var(--label-tertiary);
          margin-top: var(--space-3);
        }
        .auth-form__alt a {
          color: var(--accent);
          text-decoration: none;
          font-weight: var(--type-body-emphasis-weight);
        }
        .auth-form__alt a:hover { text-decoration: underline; }
      `}</style>
    </form>
  );
}