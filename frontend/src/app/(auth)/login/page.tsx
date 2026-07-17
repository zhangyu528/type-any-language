'use client';

/**
 * /login — email + password sign-in with full UX polish (A+B combo).
 *
 * A: micro-interactions
 *   - Submit spinner inside the button (replaces the bare "登录中…" text)
 *   - Password visibility toggle (eye icon morph)
 *   - Field icons (envelope / lock)
 *   - Card-level shake on error (key-based re-trigger)
 *   - Success dissolve: card scale 0.96 + fade out, then navigate
 *
 * B: real-time input feedback
 *   - Email onBlur regex check (separate from server errors — clears
 *     as soon as the user keeps typing)
 *   - Error auto-focus: first invalid field gets focused on submit
 *     failure so the user doesn't have to hunt
 *
 * (Password strength / requirements checklist are signup-only — they
 * help users pick a good password, which only makes sense at signup.)
 */
import { useRouter } from 'next/navigation';
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
  const [emailFormatError, setEmailFormatError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dissolving, setDissolving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Bumped on every error event so the wrapper div re-mounts and
  // re-triggers the shake animation. Form state is preserved because
  // the wrapper is the parent — only its key changes, not the form's.
  const [shakeKey, setShakeKey] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const validateEmail = useCallback((value: string): string | null => {
    if (!value) return null;
    // Pragmatic regex — not RFC 5322 perfect, but matches the
    // "looks like an email" cases and rejects obvious typos.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return '邮箱格式不正确';
    }
    return null;
  }, []);

  // Trigger card shake + auto-focus first invalid field whenever
  // a new error arrives.
  useEffect(() => {
    const hasErrors = Object.values(errors).some(Boolean);
    if (hasErrors) {
      setShakeKey((k) => k + 1);
      // Focus the first invalid field. Server errors land on email
      // (since the backend returns one generic "Invalid email or
      // password" message for both wrong-pw and unknown-email).
      const order: (keyof FieldErrors)[] = ['email', 'password'];
      const firstInvalid = order.find((k) => errors[k]);
      if (firstInvalid === 'email') emailRef.current?.focus();
      else if (firstInvalid === 'password') passwordRef.current?.focus();
    }
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || dissolving) return;

    // Run client-side validation first — don't bother the server if
    // the local state is already wrong.
    const localEmailError = validateEmail(email);
    if (localEmailError) {
      setEmailFormatError(localEmailError);
      setShakeKey((k) => k + 1);
      emailRef.current?.focus();
      return;
    }

    setErrors({});
    setEmailFormatError(null);
    setSubmitting(true);
    try {
      await apiLogin({ email: email.trim(), password });
      // Brief dissolve before navigation so the success is felt, not
      // instantaneous — 200ms is enough to register without making
      // the redirect feel slow.
      setDissolving(true);
      await new Promise((r) => setTimeout(r, 200));
      await refresh();
      router.replace('/history');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as FieldErrors);
      } else {
        setErrors({ email: apiErr.message ?? '登录失败' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Email error precedence: server field error wins over client format
  // error (the server has the final say on whether this email exists).
  const emailError = errors.email || emailFormatError;

  return (
    <div key={`shake-${shakeKey}`} className="auth-form-shake-wrap">
      <form
        onSubmit={onSubmit}
        className={`auth-form${dissolving ? ' auth-form--dissolving' : ''}`}
        noValidate
      >
        <h1 className="auth-title">
          {Array.from('欢迎回来').map((char, i) => (
            <span
              key={i}
              className="auth-title__char"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {char}
            </span>
          ))}
        </h1>

        <p className="auth-form__subtitle">继续你的练习</p>

        <label className="auth-field auth-field-1">
          <span className="auth-field__label">邮箱</span>
          <span className="auth-field__input-wrap">
            <svg
              className="auth-field__icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="2" y="3.5" width="12" height="9" rx="1" />
              <path d="M2.5 4.5 L8 9 L13.5 4.5" />
            </svg>
            <input
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-invalid={emailError ? true : undefined}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) {
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }
                if (emailFormatError) {
                  setEmailFormatError(validateEmail(e.target.value));
                }
              }}
              onBlur={(e) => {
                setEmailFormatError(validateEmail(e.target.value));
              }}
              className={`auth-field__input auth-field__input--with-icon${emailError ? ' auth-field__input--error' : ''}`}
            />
          </span>
          {emailError ? (
            <span className="auth-field__error" role="alert">{emailError}</span>
          ) : null}
        </label>

        <label className="auth-field auth-field-2">
          <span className="auth-field__label">密码</span>
          <span className="auth-field__input-wrap">
            <svg
              className="auth-field__icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="7" width="10" height="7" rx="1" />
              <path d="M5 7 V5 a3 3 0 0 1 6 0 V7" />
            </svg>
            <input
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={72}
              aria-invalid={errors.password ? true : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              className={`auth-field__input auth-field__input--with-icon auth-field__input--with-toggle${errors.password ? ' auth-field__input--error' : ''}`}
            />
            <button
              type="button"
              className="auth-field__toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 8 C3.5 4.5 5.5 3 8 3 s4.5 1.5 6 5 c-1.5 3.5 -3.5 5 -6 5 s-4.5 -1.5 -6 -5 z" />
                  <circle cx="8" cy="8" r="2" />
                  <path d="M2 2 L14 14" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 8 C3.5 4.5 5.5 3 8 3 s4.5 1.5 6 5 c-1.5 3.5 -3.5 5 -6 5 s-4.5 -1.5 -6 -5 z" />
                  <circle cx="8" cy="8" r="2" />
                </svg>
              )}
            </button>
          </span>
          {errors.password ? (
            <span className="auth-field__error" role="alert">{errors.password}</span>
          ) : null}
        </label>

        <button type="submit" disabled={submitting || dissolving} className="auth-form__submit">
          {submitting ? (
            <>
              <svg
                className="auth-form__spinner"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeDasharray="28 60"
                />
              </svg>
              <span>登录中…</span>
            </>
          ) : (
            <span>登录</span>
          )}
        </button>

        <p className="auth-form__alt">
          还没有账号？<Link href="/signup">注册</Link>
        </p>

        <style dangerouslySetInnerHTML={{ __html: `
          .auth-form-shake-wrap {
            animation: auth-form-shake 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
          }
          @keyframes auth-form-shake {
            0%, 100% { transform: translateX(0); }
            20%      { transform: translateX(-6px); }
            40%      { transform: translateX(6px); }
            60%      { transform: translateX(-4px); }
            80%      { transform: translateX(4px); }
          }
          .auth-form {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
            /* Success dissolve: scale 0.96 + fade out, ~200ms.
               The setTimeout in onSubmit waits for this before
               navigating, so the user sees the success instead of
               an instantaneous route change. */
            transition: opacity 200ms var(--ease-standard),
                        transform 200ms var(--ease-standard);
          }
          .auth-form--dissolving {
            opacity: 0;
            transform: scale(0.96);
            pointer-events: none;
          }
          .auth-field {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            /* Stagger entry — .auth-field-1/2 set the per-field delay
               (200/280ms after the card starts rising). 400ms duration
               so the last field is in place by ~680ms. */
            animation: auth-field-rise 400ms var(--ease-emphasized) both;
          }
          .auth-field-1 { animation-delay: 200ms; }
          .auth-field-2 { animation-delay: 280ms; }
          .auth-field__label {
            font-size: var(--type-caption);
            color: var(--label-tertiary);
            letter-spacing: 0.02em;
          }
          .auth-field__input-wrap {
            position: relative;
            display: flex;
            align-items: center;
          }
          .auth-field__icon {
            position: absolute;
            left: var(--space-3);
            color: var(--label-quaternary);
            pointer-events: none;
            transition: color var(--duration-fast) var(--ease-standard);
          }
          .auth-field__input-wrap:focus-within .auth-field__icon {
            color: var(--label-secondary);
          }
          .auth-field__input-wrap:focus-within .auth-field__input--error ~ .auth-field__icon,
          .auth-field__input--error ~ .auth-field__icon {
            color: var(--accent);
          }
          .auth-field__input {
            width: 100%;
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
          .auth-field__input--with-icon { padding-left: 36px; }
          .auth-field__input--with-toggle { padding-right: 40px; }
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
          .auth-field__toggle {
            position: absolute;
            right: var(--space-2);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background: transparent;
            border: 0;
            border-radius: var(--radius-sm);
            color: var(--label-quaternary);
            cursor: pointer;
            padding: 0;
            transition: color var(--duration-fast) var(--ease-standard),
                        background var(--duration-fast) var(--ease-standard);
          }
          .auth-field__toggle:hover {
            color: var(--label-secondary);
            background: rgba(0, 0, 0, 0.04);
          }
          .auth-field__toggle:focus-visible {
            outline: 2px solid var(--label-primary);
            outline-offset: 1px;
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
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
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
          .auth-form__submit:disabled { opacity: 0.7; cursor: progress; }
          .auth-form__spinner {
            animation: auth-form-spin 800ms linear infinite;
          }
          @keyframes auth-form-spin {
            to { transform: rotate(360deg); }
          }
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

          /* Subtitle (just under the title). Lands after the title's
             last char finishes rising (3 chars × 50ms = 150ms).
             Negative margin-top pulls it into the title's 16px gap,
             so visually title↔subtitle = 4px while keeping the
             form-level gap unchanged for label↔field, etc. */
          .auth-form__subtitle {
            font-size: var(--type-body);
            color: var(--label-tertiary);
            margin: 0;
            margin-top: calc(var(--space-4) * -1 + var(--space-1));
            animation: auth-field-rise 400ms var(--ease-emphasized) both;
            animation-delay: 160ms;
          }

          /* Focus ring: 4px soft ring on the input when its wrap has
             focus. Existing icon-color transition stays. */
          .auth-field__input-wrap:focus-within .auth-field__input {
            border-color: var(--label-secondary);
            box-shadow: 0 0 0 4px rgba(28, 28, 30, 0.08);
          }

          /* Error state on the input itself: red border + red soft ring +
             brief 240ms attention motion. The whole-card shake is already
             covered by .auth-form-shake-wrap on submit error. */
          .auth-field__input--error,
          .auth-field__input-wrap:focus-within .auth-field__input--error {
            border-color: var(--accent);
            box-shadow: 0 0 0 4px rgba(215, 0, 21, 0.10);
            animation: auth-field-error-attn 240ms var(--ease-standard) both;
          }
          @keyframes auth-field-error-attn {
            0%, 100% { transform: translateX(0); }
            30%      { transform: translateX(-2px); }
            70%      { transform: translateX(2px); }
          }

          @media (prefers-reduced-motion: reduce) {
            .auth-form__subtitle { animation: none !important; }
            .auth-field__input--error { animation: none !important; }
          }
        ` }} />
      </form>
    </div>
  );
}
