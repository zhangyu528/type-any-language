'use client';

/**
 * /login — email + password sign-in with field-level errors.
 *
 * For login, errors are typically form-wide (wrong password, unknown
 * email) rather than per-field. We map server-side fieldErrors back
 * to the right input when present, otherwise show a form-level error
 * on the email field (since "Invalid email or password" is always
 * tied to one of the two fields).
 *
 * See KNOWN_ISSUES.md §4.4 for why `await refresh()` before navigate.
 */
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { apiLogin, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      await apiLogin({ email: email.trim(), password });
      await refresh();
      router.replace('/history');
    } catch (err) {
      const apiErr = err as ApiError;
      // Login backend returns one generic "Invalid email or password"
      // for both wrong-pw and unknown-email (no enumeration). Show it
      // on the email field so the user sees the error near the input.
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as FieldErrors);
      } else {
        setErrors({ email: apiErr.message ?? '登录失败' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function clearError(field: keyof FieldErrors) {
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  return (
    <form onSubmit={onSubmit} className="auth-form" noValidate>
      <h1>欢迎回来</h1>

      <label className="auth-field">
        <span className="auth-field__label">邮箱</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          aria-invalid={errors.email ? true : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError('email');
          }}
          className={`auth-field__input${errors.email ? ' auth-field__input--error' : ''}`}
        />
        {errors.email ? (
          <span className="auth-field__error" role="alert">{errors.email}</span>
        ) : null}
      </label>

      <label className="auth-field">
        <span className="auth-field__label">密码</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={72}
          aria-invalid={errors.password ? true : undefined}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError('password');
          }}
          className={`auth-field__input${errors.password ? ' auth-field__input--error' : ''}`}
        />
        {errors.password ? (
          <span className="auth-field__error" role="alert">{errors.password}</span>
        ) : null}
      </label>

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
                      border-color var(--duration-fast) var(--ease-standard),
                      box-shadow var(--duration-fast) var(--ease-standard);
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
        .auth-field__input--error {
          border-color: var(--accent);
          background: rgba(251, 233, 235, 0.7);
        }
        .auth-field__input--error:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(215, 0, 21, 0.12);
        }
        .auth-field__error {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--type-caption);
          color: var(--accent);
          margin-top: var(--space-1);
        }
        .auth-field__error::before {
          content: "⚠";
          font-size: 11px;
          flex-shrink: 0;
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