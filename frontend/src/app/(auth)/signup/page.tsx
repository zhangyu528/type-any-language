'use client';

/**
 * /signup — email + password + confirm, with live password strength.
 *
 * Implementation per design-auth.md:
 *   - Title 4 chars × 50ms stagger (auth-char-rise)
 *   - Subtitle 110ms after title (slightly earlier than login to
 *     emphasize "quick" copy)
 *   - 3 field stagger: 200ms / 280ms / 340ms
 *   - Password strength meter (5-point scale, live updates)
 *   - Requirements checklist (✓ / ○ per rule)
 *   - Confirm-password match check
 *   - Card shake on submit error + per-field attention motion
 *   - Success dissolve → /history
 *
 * API:
 *   POST /api/auth/signup { email, password, display_name? } →
 *   UserPublic + Set-Cookie. On success, refresh() the AuthProvider
 *   so the top chrome swaps login pill → avatar before the route
 *   changes.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Suspense,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiSignup, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';
import { safeRedirectPath } from '../../lib/safeRedirect';

interface FieldErrors {
  email?: string;
  password?: string;
  confirm?: string;
}

// UI hint, not a real strength gate. Backend enforces 8+ chars length
// only. See design-auth.md §7.
function calcPasswordStrength(pw: string): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasLetter = hasLower || hasUpper;
  const hasDigit = /\d/.test(pw);
  if (score >= 1 && hasLetter && hasDigit) score++;
  if (score >= 2 && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  return Math.min(score, 5) as 0 | 1 | 2 | 3 | 4 | 5;
}

interface Requirement {
  id: string;
  label: string;
  met: boolean;
}

function getRequirements(pw: string): Requirement[] {
  return [
    { id: 'len8', label: '至少 8 个字符', met: pw.length >= 8 },
    { id: 'letter', label: '包含字母', met: /[A-Za-z]/.test(pw) },
    { id: 'digit', label: '包含数字', met: /\d/.test(pw) },
    { id: 'special', label: '包含特殊字符', met: /[^A-Za-z0-9]/.test(pw) },
  ];
}

/**
 * Suspense shell — required by Next.js 14 for any page that calls
 * useSearchParams(). Without this, the page bails to the not-found
 * boundary during the initial render. The fallback is a thin
 * placeholder card so there's no flash between hydration and the
 * signup form appearing.
 */
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
  const { refresh } = useAuth();
  // Read ?from= once on mount. safeRedirectPath() defends against
  // open-redirect attacks. Fallback to '/' when absent or invalid.
  const fromParam = searchParams?.get('from') ?? null;
  const redirectTo = safeRedirectPath(fromParam, '/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [emailFormatError, setEmailFormatError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dissolving, setDissolving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const strength = useMemo(() => calcPasswordStrength(password), [password]);
  const requirements = useMemo(() => getRequirements(password), [password]);

  const validateEmail = (value: string): string | null => {
    if (!value) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return '邮箱格式不正确';
    }
    return null;
  };

  useEffect(() => {
    const hasErrors = Object.values(errors).some(Boolean);
    if (hasErrors) {
      setShakeKey((k) => k + 1);
      const order: (keyof FieldErrors)[] = ['email', 'password', 'confirm'];
      const firstInvalid = order.find((k) => errors[k]);
      if (firstInvalid === 'email') emailRef.current?.focus();
      else if (firstInvalid === 'password') passwordRef.current?.focus();
      else if (firstInvalid === 'confirm') confirmRef.current?.focus();
    }
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || dissolving) return;

    const localEmailError = validateEmail(email);
    const localErrors: FieldErrors = {};
    if (localEmailError) localErrors.email = localEmailError;
    if (password.length < 8) localErrors.password = '密码至少 8 个字符';
    if (confirm !== password) localErrors.confirm = '两次输入的密码不一致';

    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      setEmailFormatError(localEmailError);
      setShakeKey((k) => k + 1);
      if (localErrors.email) emailRef.current?.focus();
      else if (localErrors.password) passwordRef.current?.focus();
      else if (localErrors.confirm) confirmRef.current?.focus();
      return;
    }

    setErrors({});
    setEmailFormatError(null);
    setSubmitting(true);
    try {
      await apiSignup({ email: email.trim(), password });
      setDissolving(true);
      await new Promise((r) => setTimeout(r, 200));
      await refresh();
      router.replace('/history');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as FieldErrors);
      } else {
        setErrors({ email: apiErr.message ?? '注册失败' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const emailError = errors.email || emailFormatError;
  const passwordError = errors.password;
  const confirmError = errors.confirm;

  return (
    <div key={`shake-${shakeKey}`} className="auth-form-shake-wrap">
      <form
        onSubmit={onSubmit}
        className={`auth-form${dissolving ? ' auth-form--dissolving' : ''}`}
        noValidate
      >
        <h1 className="auth-title">
          {Array.from('创建账号').map((char, i) => (
            <span
              key={i}
              className="auth-title__char"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {char}
            </span>
          ))}
        </h1>

        <p className="auth-form__subtitle">几秒钟创建账号</p>

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
              onChange={(ev) => {
                setEmail(ev.target.value);
                if (errors.email) {
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }
                if (emailFormatError) {
                  setEmailFormatError(validateEmail(ev.target.value));
                }
              }}
              onBlur={(ev) => setEmailFormatError(validateEmail(ev.target.value))}
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
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              aria-invalid={passwordError ? true : undefined}
              value={password}
              onChange={(ev) => {
                setPassword(ev.target.value);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }
                // also clear confirm mismatch live as user edits password
                if (errors.confirm && ev.target.value === confirm) {
                  setErrors((prev) => ({ ...prev, confirm: undefined }));
                }
              }}
              className={`auth-field__input auth-field__input--with-icon auth-field__input--with-toggle${passwordError ? ' auth-field__input--error' : ''}`}
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

          {password.length > 0 ? (
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
                  <li key={req.id} className={req.met ? 'is-met' : ''}>
                    {req.met ? '✓' : '○'} {req.label}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {passwordError ? (
            <span className="auth-field__error" role="alert">{passwordError}</span>
          ) : null}
        </label>

        <label className="auth-field auth-field-3">
          <span className="auth-field__label">确认密码</span>
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
              <path d="M6 11 l1.5 1.5 L11 9" />
            </svg>
            <input
              ref={confirmRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              aria-invalid={confirmError ? true : undefined}
              value={confirm}
              onChange={(ev) => {
                const v = ev.target.value;
                setConfirm(v);
                if (errors.confirm && v === password) {
                  setErrors((prev) => ({ ...prev, confirm: undefined }));
                }
              }}
              className={`auth-field__input auth-field__input--with-icon${confirmError ? ' auth-field__input--error' : ''}`}
            />
          </span>
          {confirmError ? (
            <span className="auth-field__error" role="alert">{confirmError}</span>
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
              <span>注册中…</span>
            </>
          ) : (
            <span>注册</span>
          )}
        </button>

        <p className="auth-form__alt">
          已有账号？<Link href="/login">登录</Link>
        </p>

        {/* CSS lives here (not in globals.css) so it ships only on the
            auth pages — keeps the read-layer's main bundle small and
            lets us iterate on auth visuals without touching the
            design system.

            Using dangerouslySetInnerHTML is intentional: with
            `<style>{css}</style>` the JSX child gets re-stringified
            at hydration time and any whitespace difference between
            server and client blows up with "Text content does not
            match server-rendered HTML". dangerouslySetInnerHTML
            passes the bytes through verbatim — no re-stringification,
            no mismatch. */}
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
          .auth-field-3 { animation-delay: 340ms; }
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
          .auth-field__input-wrap:focus-within .auth-field__input {
            border-color: var(--label-secondary);
            box-shadow: 0 0 0 4px rgba(28, 28, 30, 0.08);
          }
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

          /* Password strength meter (signup-only) */
          .auth-field__strength {
            position: relative;
            width: 100%;
            height: 4px;
            background: rgba(0, 0, 0, 0.06);
            border-radius: var(--radius-circle);
            overflow: hidden;
          }
          .auth-field__strength-bar {
            height: 100%;
            width: 0%;
            border-radius: var(--radius-circle);
            background: var(--accent);
            transition: width var(--duration-fast) var(--ease-standard),
                        background var(--duration-fast) var(--ease-standard);
          }
          .auth-field__strength[data-score="0"] .auth-field__strength-bar { width: 0%; }
          .auth-field__strength[data-score="1"] .auth-field__strength-bar { width: 20%; background: var(--accent); }
          .auth-field__strength[data-score="2"] .auth-field__strength-bar { width: 40%; background: #F5A623; }
          .auth-field__strength[data-score="3"] .auth-field__strength-bar { width: 60%; background: #F5A623; }
          .auth-field__strength[data-score="4"] .auth-field__strength-bar { width: 80%; background: #34C759; }
          .auth-field__strength[data-score="5"] .auth-field__strength-bar { width: 100%; background: #34C759; }

          .auth-field__requirements {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-1) var(--space-3);
            font-size: var(--type-caption);
            color: var(--label-tertiary);
          }
          .auth-field__requirements li {
            display: flex;
            align-items: center;
            gap: var(--space-1);
          }
          .auth-field__requirements li.is-met {
            color: var(--label-secondary);
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

          .auth-form__subtitle {
            font-size: var(--type-body);
            color: var(--label-tertiary);
            margin: 0;
            margin-top: calc(var(--space-4) * -1 + var(--space-1));
            animation: auth-field-rise 400ms var(--ease-emphasized) both;
            animation-delay: 110ms;
          }

          @media (prefers-reduced-motion: reduce) {
            .auth-form-shake-wrap { animation: none !important; }
            .auth-form { transition: none !important; }
            .auth-field { animation: none !important; opacity: 1; transform: none; }
            .auth-form__subtitle { animation: none !important; opacity: 1; transform: none; }
            .auth-field__input--error { animation: none !important; }
            .auth-form__spinner { animation: none !important; }
            .auth-field__strength-bar { transition: none !important; }
          }
        ` }} />
      </form>
    </div>
  );
}
