'use client';

/**
 * /signup — email + display_name + password registration (A+B combo).
 *
 * A: micro-interactions (shared with login)
 *   - Submit spinner, password visibility toggle, field icons
 *   - Card shake on error, success dissolve before navigation
 *
 * B: real-time input feedback
 *   - Email onBlur regex check
 *   - Display name length hint ("8 / 50" live as user types)
 *   - Password strength meter (gradient bar red→yellow→green)
 *   - Password requirements checklist (✓ / ○ per rule, live)
 *   - Error auto-focus: first invalid field gets focused
 *
 * Password strength is signup-only — at login the user already
 * has a password, showing "weak" there would just be noise.
 */
import { useRouter } from 'next/navigation';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { apiSignup, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';

interface FieldErrors {
  email?: string;
  password?: string;
  display_name?: string;
  _form?: string;
}

const DISPLAY_NAME_MAX = 50;

// 0 = no password, 5 = strongest. Heuristic, not zxcvbn — good enough
// for a UI hint, not a real strength gate (the backend enforces 8+).
function calcPasswordStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 5);
}

interface Requirement {
  key: string;
  label: string;
  met: boolean;
}

function getRequirements(pw: string): Requirement[] {
  return [
    { key: 'length', label: '至少 8 字符',  met: pw.length >= 8 },
    { key: 'letter', label: '包含字母',      met: /[a-zA-Z]/.test(pw) },
    { key: 'digit',  label: '包含数字',      met: /\d/.test(pw) },
    { key: 'upper',  label: '包含大写字母',  met: /[A-Z]/.test(pw) },
  ];
}

export default function SignupPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [emailFormatError, setEmailFormatError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dissolving, setDissolving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const strength = useMemo(() => calcPasswordStrength(password), [password]);
  const requirements = useMemo(() => getRequirements(password), [password]);

  const validateEmail = useCallback((value: string): string | null => {
    if (!value) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return '邮箱格式不正确';
    }
    return null;
  }, []);

  useEffect(() => {
    const hasErrors = Object.values(errors).some(Boolean);
    if (hasErrors) {
      setShakeKey((k) => k + 1);
      // Server field errors map to the first invalid field. Order
      // matches the form's visual order.
      const order: (keyof FieldErrors)[] = ['email', 'display_name', 'password'];
      const firstInvalid = order.find((k) => errors[k]);
      if (firstInvalid === 'email') emailRef.current?.focus();
      else if (firstInvalid === 'display_name') displayNameRef.current?.focus();
      else if (firstInvalid === 'password') passwordRef.current?.focus();
    }
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || dissolving) return;

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
      await apiSignup({
        email: email.trim(),
        password,
        display_name: displayName.trim(),
      });
      setDissolving(true);
      await new Promise((r) => setTimeout(r, 200));
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
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      delete next._form;
      return next;
    });
  }

  const emailError = errors.email || emailFormatError;
  const showPasswordExtras = password.length > 0;

  return (
    <div key={`shake-${shakeKey}`} className="auth-form-shake-wrap">
      <form
        onSubmit={onSubmit}
        className={`auth-form${dissolving ? ' auth-form--dissolving' : ''}`}
        noValidate
      >
        <h1 className="auth-title">
          {Array.from('注册').map((char, i) => (
            <span
              key={i}
              className="auth-title__char"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {char}
            </span>
          ))}
        </h1>

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
                if (errors.email) clearError('email');
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
          <span className="auth-field__label-row">
            <span className="auth-field__label">显示名</span>
            <span
              className={`auth-field__counter${displayName.length > DISPLAY_NAME_MAX ? ' auth-field__counter--over' : ''}`}
              aria-live="polite"
            >
              {displayName.length} / {DISPLAY_NAME_MAX}
            </span>
          </span>
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
              <circle cx="8" cy="5.5" r="2.75" />
              <path d="M3 13 c0 -2.5 2.25 -4 5 -4 s5 1.5 5 4" />
            </svg>
            <input
              ref={displayNameRef}
              type="text"
              autoComplete="nickname"
              required
              maxLength={DISPLAY_NAME_MAX}
              aria-invalid={errors.display_name ? true : undefined}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (errors.display_name) clearError('display_name');
              }}
              className={`auth-field__input auth-field__input--with-icon${errors.display_name ? ' auth-field__input--error' : ''}`}
            />
          </span>
          {errors.display_name ? (
            <span className="auth-field__error" role="alert">{errors.display_name}</span>
          ) : null}
        </label>

        <label className="auth-field auth-field-3">
          <span className="auth-field__label">密码 (8-72 位)</span>
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
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              aria-invalid={errors.password ? true : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) clearError('password');
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

          {showPasswordExtras && (
            <>
              <div
                className="auth-field__strength"
                data-score={strength}
                role="meter"
                aria-label="密码强度"
                aria-valuemin={0}
                aria-valuemax={5}
                aria-valuenow={strength}
              >
                <div className="auth-field__strength-bar" />
              </div>
              <ul className="auth-field__requirements">
                {requirements.map((req) => (
                  <li
                    key={req.key}
                    className={`auth-field__req${req.met ? ' auth-field__req--met' : ''}`}
                  >
                    <span className="auth-field__req-icon" aria-hidden>
                      {req.met ? '✓' : '○'}
                    </span>
                    {req.label}
                  </li>
                ))}
              </ul>
            </>
          )}

          {errors.password ? (
            <span className="auth-field__error" role="alert">{errors.password}</span>
          ) : null}
        </label>

        {errors._form ? (
          <p className="auth-form__form-error" role="alert">{errors._form}</p>
        ) : null}

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
              <span>注册中…</span>
            </>
          ) : (
            <span>注册</span>
          )}
        </button>

        <p className="auth-form__alt">
          已经有账号？<Link href="/login">登录</Link>
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
            animation: auth-field-rise 400ms var(--ease-emphasized) both;
          }
          .auth-field-1 { animation-delay: 200ms; }
          .auth-field-2 { animation-delay: 280ms; }
          .auth-field-3 { animation-delay: 360ms; }
          .auth-field__label-row {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: var(--space-2);
          }
          .auth-field__counter {
            font-size: 11px;
            color: var(--label-quaternary);
            font-variant-numeric: tabular-nums;
            transition: color var(--duration-fast) var(--ease-standard);
          }
          .auth-field__counter--over {
            color: var(--accent);
            font-weight: 600;
          }
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
          .auth-field__strength {
            height: 3px;
            background: rgba(0, 0, 0, 0.06);
            border-radius: 2px;
            overflow: hidden;
            margin-top: 2px;
          }
          .auth-field__strength-bar {
            height: 100%;
            width: 0%;
            background: var(--label-quaternary);
            border-radius: 2px;
            transition: width 200ms var(--ease-standard),
                        background-color 200ms var(--ease-standard);
          }
          .auth-field__strength[data-score="0"] .auth-field__strength-bar { width: 0%; }
          .auth-field__strength[data-score="1"] .auth-field__strength-bar { width: 20%; background: var(--accent); }
          .auth-field__strength[data-score="2"] .auth-field__strength-bar { width: 40%; background: #F5A623; }
          .auth-field__strength[data-score="3"] .auth-field__strength-bar { width: 60%; background: #F5A623; }
          .auth-field__strength[data-score="4"] .auth-field__strength-bar { width: 80%; background: #34C759; }
          .auth-field__strength[data-score="5"] .auth-field__strength-bar { width: 100%; background: #34C759; }
          .auth-field__requirements {
            list-style: none;
            margin: 4px 0 0;
            padding: 0;
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2) var(--space-3);
            font-size: 11px;
            color: var(--label-quaternary);
          }
          .auth-field__req {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: color var(--duration-fast) var(--ease-standard);
          }
          .auth-field__req-icon {
            font-size: 10px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 11px;
            height: 11px;
          }
          .auth-field__req--met {
            color: #34C759;
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
        ` }} />
      </form>
    </div>
  );
}
