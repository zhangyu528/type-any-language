'use client';

/**
 * /signup — email + password + display_name registration.
 *
 * Field-level errors: each field can independently show its own
 * validation/auth error (red border + message below). The ApiError
 * type carries an optional `fieldErrors` map (e.g. {"email": "邮箱已被注册"})
 * which the form maps back onto the right input.
 *
 * See KNOWN_ISSUES.md §4.4 for why `await refresh()` before navigate.
 */
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { apiSignup, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';

interface FieldErrors {
  email?: string;
  password?: string;
  display_name?: string;
  _form?: string;
}

export default function SignupPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setErrors({});
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
      const apiErr = err as ApiError;
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as FieldErrors);
      } else {
        setErrors({ _form: apiErr.message ?? '注册失败' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function clearError(field: keyof FieldErrors) {
    if (errors[field] || errors._form) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        delete next._form;
        return next;
      });
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
        <span className="auth-field__label">显示名</span>
        <input
          type="text"
          autoComplete="nickname"
          required
          aria-invalid={errors.display_name ? true : undefined}
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            clearError('display_name');
          }}
          className={`auth-field__input${errors.display_name ? ' auth-field__input--error' : ''}`}
        />
        {errors.display_name ? (
          <span className="auth-field__error" role="alert">{errors.display_name}</span>
        ) : null}
      </label>

      <label className="auth-field">
        <span className="auth-field__label">密码 (8-72 位)</span>
        <input
          type="password"
          autoComplete="new-password"
          required
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

      {errors._form ? (
        <p className="auth-form__form-error" role="alert">{errors._form}</p>
      ) : null}

      <button type="submit" disabled={submitting} className="auth-form__submit">
        {submitting ? '注册中…' : '注册'}
      </button>

      <p className="auth-form__alt">
        已经有账号？<Link href="/login">登录</Link>
      </p>

      <style dangerouslySetInnerHTML={{ __html: `
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
        .auth-form__form-error {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--type-caption);
          color: var(--accent);
          background: rgba(251, 233, 235, 0.6);
          border: 1px solid rgba(215, 0, 21, 0.18);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          margin: 0;
        }
        .auth-form__form-error::before {
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
      ` }} />
    </form>
  );
}