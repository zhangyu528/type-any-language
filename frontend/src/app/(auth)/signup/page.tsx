'use client';

/**
 * /signup — step-by-screen sign-up UI.
 *
 * Visual style mirrors /login: per-screen subtitle carousel, hero
 * CN/EN pair, underline-only input, 56×56 icon-only Next button,
 * 3-dot progress (2 dots only — signup has 2 screens, dot count
 * is honest), pane cross-fade. The flow is 2 screens:
 *
 *   Screen 1 — email (same component as login's Screen 1, with
 *              a different title/subtitle)
 *   Screen 2 — password + confirm: two stacked PIN rows. The
 *              password row and the confirm row share one eye
 *              toggle (so toggling once reveals/hides both).
 *              A live match hint flips between "✓ 一致" (green)
 *              and "两次输入不一致" (red) as the user types.
 *              Next fires `onSubmit` when both are 8 chars and
 *              equal.
 *
 * Implementation notes:
 *   - Title 4 chars × 120ms stagger (auth-char-rise).
 *   - Subtitle 2-line, 2s fade carousel — per-screen content.
 *   - PASSWORD_LENGTH = 8 to match backend min_length=8 and
 *     login's PIN length (kept in lockstep).
 *   - Success: dissolve + refresh auth context + nav to
 *     redirectTo (the ?from= value, or '/' if absent). The
 *     legacy /history hard-code is dropped.
 *   - Reduced-motion: all motion disabled.
 *
 * API:
 *   POST /api/auth/signup { email, password } → UserPublic + Set-Cookie.
 *   On success, refresh() the AuthProvider so the top chrome swaps
 *   login pill → avatar before the route changes.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Suspense,
  ChangeEvent,
  FocusEvent,
  FormEvent,
  RefObject,
  useCallback,
  useEffect,
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

/**
 * Suspense shell — required by Next.js 14 for any page that calls
 * useSearchParams(). Without this, the page bails to the not-found
 * boundary during the initial render. The fallback is a thin
 * placeholder with the same card-rise animation so there's no flash
 * between hydration and the form appearing.
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
  // open-redirect attacks. When absent or invalid, the fallback '/'
  // kicks in. This replaces the legacy hard-coded '/history' redirect.
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
  // Bumped on every error event so the wrapper div re-mounts and
  // re-triggers the shake animation. Form state is preserved because
  // the wrapper is the parent — only its key changes, not the form's.
  const [shakeKey, setShakeKey] = useState(0);

  // Step-by-screen flow state. 1 = email, 2 = password+confirm.
  // No Screen 3 (signup commits directly from Screen 2).
  const [screen, setScreen] = useState<1 | 2>(1);


  // Subtitle carousel — per-screen CN+EN pair, 2s loop.
  const SUBTITLE_LINES_BY_SCREEN: Record<1 | 2, readonly { lang: 'zh' | 'en'; text: string }[]> = {
    1: [
      { lang: 'zh', text: '请输入邮箱' },
      { lang: 'en', text: 'Please enter your email' },
    ],
    2: [
      { lang: 'zh', text: '请输入密码' },
      { lang: 'en', text: 'Please enter your password' },
    ],
  };
  const subtitleLines = SUBTITLE_LINES_BY_SCREEN[screen];
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  useEffect(() => {
    setSubtitleIndex(0);
  }, [screen]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setSubtitleIndex((i) => (i + 1) % subtitleLines.length);
    }, 2000);
    return () => window.clearInterval(id);
  }, [subtitleLines]);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Tracks which PIN row currently holds the caret. Only the focused
  // row renders its caret + dark underline so the user can tell at
  // a glance which row they're editing. 'null' = no row focused (a
  // brief gap before the user clicks, OR after a blur; either way
  // neither row shows the caret).
  const [focusedRow, setFocusedRow] = useState<'password' | 'confirm' | null>(
    null,
  );

  const validateEmail = useCallback((value: string): string | null => {
    if (!value) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return '邮箱格式不正确';
    }
    return null;
  }, []);

  // PASSWORD_LENGTH is the single source of truth — kept in lockstep
  // with the login page (8) and the backend's min_length=8.
  const PASSWORD_LENGTH = 8;

  // Screen 1 advance gate — non-empty + valid email.
  const canAdvanceFromScreen1 =
    email.length > 0 && emailFormatError === null;

  // Screen 2 advance gate — both PIN rows are full AND match.
  // Backend enforces length-only on the password; the match check
  // is purely client-side (the backend has no "confirm" field).
  const canAdvanceFromScreen2 =
    password.length === PASSWORD_LENGTH &&
    confirm.length === PASSWORD_LENGTH &&
    password === confirm;

  // Live match hint state — drives the .auth-screen__match-hint
  // node below the two PIN rows. Four states:
  //   - empty (both inputs untouched — no message)
  //   - incomplete (at least one row has fewer than PASSWORD_LENGTH
  //     chars — soft warning: "Password needs 8 digits")
  //   - match (both full + equal — green check)
  //   - mismatch (both full + differ — red)
  const matchHint: {
    tone: 'empty' | 'incomplete' | 'match' | 'mismatch';
    zh: string;
    en: string;
  } = (() => {
    if (password.length === 0 && confirm.length === 0) {
      return { tone: 'empty', zh: '', en: '' };
    }
    if (password.length === PASSWORD_LENGTH && confirm.length === PASSWORD_LENGTH) {
      if (password === confirm) {
        // Leading ✓ comes from CSS ::before — don't duplicate here.
        return { tone: 'match', zh: '一致', en: 'match' };
      }
      // Leading ⚠ comes from CSS ::before — don't duplicate here.
      return { tone: 'mismatch', zh: '两次输入不一致', en: "Doesn't match" };
    }
    // At least one row is partial — soft warning.
    return { tone: 'incomplete', zh: '密码需要 8 位', en: 'Password needs 8 digits' };
  })();

  // Trigger card shake + bounce the user to the offending screen
  // whenever a new error arrives. Matches login's pattern; field
  // errors route to the screen that owns the field.
  useEffect(() => {
    const hasErrors = Object.values(errors).some(Boolean);
    if (!hasErrors) return;
    setShakeKey((k) => k + 1);
    if (errors.email) {
      setScreen(1);
      requestAnimationFrame(() => emailRef.current?.focus());
    } else if (errors.password || errors.confirm) {
      setScreen(2);
      // Prefer focusing password (the field the user most likely
      // needs to fix); the confirm ref is the secondary target.
      requestAnimationFrame(() => passwordRef.current?.focus());
    }
  }, [errors]);

  // Auto-focus the password row when the user lands on Screen 2.
  // Without this, focusedRow stays null and neither row shows the
  // caret until the user clicks — first-impression "nothing's
  // happening" is the worst state. The onFocus handler on the
  // hidden input picks up from here and sets focusedRow to
  // 'password', so the caret appears in the right slot.
  useEffect(() => {
    if (screen === 2) {
      const id = window.setTimeout(
        () => passwordRef.current?.focus(),
        80,
      );
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [screen]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Only Screen 2's Next button (type="submit") should ever reach
    // here. A stray Enter on the email input on Screen 1 must NOT
    // hit the API.
    if (screen !== 2) return;
    if (submitting || dissolving) return;

    // Client-side validation gate. canAdvanceFromScreen2 already
    // checks length + match; we re-run the email check too in case
    // the user advanced with a valid email then it became invalid
    // (it can't, but defense in depth).
    const localErrors: FieldErrors = {};
    const localEmailError = validateEmail(email);
    if (localEmailError) localErrors.email = localEmailError;
    if (password.length < PASSWORD_LENGTH) {
      localErrors.password = `密码至少 ${PASSWORD_LENGTH} 个字符`;
    }
    if (confirm !== password) {
      localErrors.confirm = '两次输入的密码不一致';
    }
    if (Object.values(localErrors).some(Boolean)) {
      setErrors(localErrors);
      if (localEmailError) setEmailFormatError(localEmailError);
      setShakeKey((k) => k + 1);
      if (localErrors.email) {
        setScreen(1);
        requestAnimationFrame(() => emailRef.current?.focus());
      } else {
        // password or confirm error — stay on Screen 2, focus pw.
        requestAnimationFrame(() => passwordRef.current?.focus());
      }
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
      // Land on the page the user came from (/?lib=X if they were
      // practicing), or `/` if no `?from=` was supplied. Replaces
      // the legacy hard-coded '/history' redirect.
      router.replace(redirectTo);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as FieldErrors);
        if (apiErr.fieldErrors.email) setScreen(1);
        else if (apiErr.fieldErrors.password || apiErr.fieldErrors.confirm) {
          setScreen(2);
        }
      } else {
        // Backend 409 "该邮箱已注册" lands here (no field_errors
        // envelope). Surface on the email slot — it IS an email
        // problem even though the backend didn't tag it as one.
        setErrors({ email: apiErr.message ?? '注册失败' });
        setScreen(1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Email error precedence: server field error wins over client
  // format error (the server has the final say on whether this
  // email exists).
  const emailError = errors.email || emailFormatError;

  // Screen 1 event handlers. Typed buffer mirrors email on Screen 1
  // and feeds the per-char highlight on the small EN hint below the
  // hero CN word.
  const TARGET_WORD = 'email';

  function onEmailChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setEmail(next);
    if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
    if (emailFormatError) setEmailFormatError(validateEmail(next));
  }

  function onEmailFocus() {
    // No-op on Screen 1.
  }

  function onEmailBlur(e: FocusEvent<HTMLInputElement>) {
    setEmailFormatError(validateEmail(e.target.value));
  }

  function onPasswordChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setPassword(next);
    if (errors.password) {
      setErrors((p) => ({ ...p, password: undefined }));
    }
    // Live-clear confirm mismatch as soon as the password side is
    // edited and matches the confirm side again.
    if (errors.confirm && next === confirm) {
      setErrors((p) => ({ ...p, confirm: undefined }));
    }
  }

  function onConfirmChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setConfirm(next);
    if (errors.confirm && next === password) {
      setErrors((p) => ({ ...p, confirm: undefined }));
    }
  }

  function onNext() {
    if (screen === 1) {
      if (!canAdvanceFromScreen1) return;
      setScreen(2);
      // Soft-focus the password input on the next frame, after
      // React commits the screen-2 JSX.
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }
    if (screen === 2 && !canAdvanceFromScreen2) return;
    // (Screen 2's Next button is type="submit" — no explicit
    // submit call needed.)
  }

  function onPrev() {
    if (screen === 2) {
      setScreen(1);
      requestAnimationFrame(() => emailRef.current?.focus());
    }
  }

  return (
    <div key={`shake-${shakeKey}`} className="auth-form-shake-wrap">
      <form
        onSubmit={onSubmit}
        className={`auth-screen${dissolving ? ' auth-screen--dissolving' : ''}`}
        noValidate
      >
        <h1 className="auth-title" style={{ color: '#16A35E' }}>
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

        <div className="auth-screen__subtitle" aria-live="polite" style={{ color: "#3FD17A" }}>
          {subtitleLines.map((line, i) => (
            <span
              key={`${screen}-${line.lang}`}
              className="auth-screen__subtitle-line"
              data-active={i === subtitleIndex ? 'true' : 'false'}
              lang={line.lang}
            >
              {line.text}
            </span>
          ))}
        </div>

        {/* All panes are mounted simultaneously; only one has
            data-active="true" and contributes height. The cross-fade
            is via the auth-screen__pane transition (240ms). */}
        <div className="auth-screen__pane" data-active={screen === 1 ? 'true' : 'false'}>
          <div className="auth-screen__stage" data-screen="1">
            <p className="auth-screen__zh-large" aria-hidden="true" style={{ color: "#16A35E" }}>
              邮箱
            </p>

            <p className="auth-screen__en-hint" aria-hidden="true" style={{ color: "#3FD17A" }}>
              email
            </p>

            <input
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-label="邮箱"
              aria-invalid={emailError ? true : undefined}
              value={email}
              onChange={onEmailChange}
              onFocus={onEmailFocus}
              onBlur={onEmailBlur}
              className="auth-screen__input"
              style={{
                borderBottom: '2px solid #3FD17A',
                caretColor: '#16A35E',
                color: '#16A35E',
              }}
            />

            {emailError ? (
              <span className="auth-field__error" role="alert">
                {emailError}
              </span>
            ) : null}

            <button
              type="button"
              onClick={onNext}
              disabled={!canAdvanceFromScreen1}
              className="auth-screen__next"
              aria-label="下一步"
            >
              <span className="auth-screen__next-arrow" aria-hidden="true">
                →
              </span>
            </button>

            <div className="auth-screen__progress" aria-hidden="true">
              <span className="auth-screen__dot" data-active="true" />
              <span className="auth-screen__dot" data-active="false" />
            </div>
          </div>
        </div>

        <div className="auth-screen__pane" data-active={screen === 2 ? 'true' : 'false'}>
          <div className="auth-screen__stage" data-screen="2">
            {/* Back button — top-left, returns to Screen 1. */}
            <button
              type="button"
              onClick={onPrev}
              className="auth-screen__back"
              aria-label="返回上一步"
            >
              <span aria-hidden="true">←</span>
            </button>

            <p className="auth-screen__zh-large" aria-hidden="true" style={{ color: "#16A35E" }}>
              密码
            </p>
            <p className="auth-screen__en-hint" aria-hidden="true" style={{ color: "#3FD17A" }}>
              password
            </p>

            {/* Row A — "设个密码". Hidden input captures keystrokes;
                the dots are derived from password.length. */}
            <div
              className="auth-screen__pin-row"
              onClick={() => passwordRef.current?.focus()}
            >
              <span className="auth-screen__pin-row-label">设个密码</span>
              <div className="auth-screen__pin">
                {Array.from({ length: PASSWORD_LENGTH }).map((_, i) => {
                  // Caret only renders when THIS row is focused AND
                  // has an empty slot to anchor to. The filled/shown
                  // states are focus-independent — the user can always
                  // see what they've typed.
                  const isCursor =
                    focusedRow === 'password' &&
                    i === password.length &&
                    password.length < PASSWORD_LENGTH;
                  const isFilled = i < password.length;
                  const isShown = isFilled && showPassword;
                  const stateClass = isCursor
                    ? 'auth-screen__pin-dot--cursor'
                    : isFilled
                      ? 'auth-screen__pin-dot--filled'
                      : '';
                  return (
                    <span
                      key={i}
                      className={`auth-screen__pin-dot ${stateClass}`.trim()}
                      data-state={isCursor ? 'cursor' : isFilled ? 'filled' : 'empty'}
                    >
                      {isShown ? password[i] : isFilled ? '•' : ''}
                    </span>
                  );
                })}
              </div>

              {/* Eye toggle — single button for the password row
                  only (the confirm row below has no toggle). The
                  toggle controls BOTH row A and row B via the
                  shared showPassword state, but visually lives
                  next to row A's dots because the user typed the
                  password here. tabIndex=-1 keeps keyboard focus
                  on the hidden input. */}
              <button
                type="button"
                onMouseDown={(e) => {
                  // Prevent the button from grabbing focus on
                  // click (some browsers like Safari ignore this,
                  // so we also force focus back via onClick below).
                  e.preventDefault();
                }}
                onClick={() => {
                  setShowPassword((v) => !v);
                  // Force focus back to whichever hidden input is
                  // active, with caret at the end. setTimeout(..., 0)
                  // schedules the focus call on the next tick, after
                  // React has committed the type-attribute change.
                  // Without this, some browsers (notably Safari)
                  // leave the focus on the button even with the
                  // mousedown preventDefault above — and the
                  // button's :focus state then captures the next
                  // backspace keypress, leaving the password value
                  // untouched. The setTimeout covers the
                  // mousedown-doesn't-help case.
                  const target =
                    focusedRow === 'confirm'
                      ? confirmRef.current
                      : passwordRef.current;
                  setTimeout(() => {
                    if (target) {
                      target.focus();
                      const end = target.value.length;
                      try {
                        target.setSelectionRange(end, end);
                      } catch {
                        /* setSelectionRange can throw on
                           type=password inputs in some browsers */
                      }
                    }
                  }, 0);
                }}
                className="auth-screen__show-toggle"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 8 C3.5 4.5 5.5 3 8 3 s4.5 1.5 6 5 c-1.5 3.5 -3.5 5 -6 5 s-4.5 -1.5 -6 -5 z" />
                    <circle cx="8" cy="8" r="2" />
                    <path d="M2 2 L14 14" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 8 C3.5 4.5 5.5 3 8 3 s4.5 1.5 6 5 c-1.5 3.5 -3.5 5 -6 5 s-4.5 -1.5 -6 -5 z" />
                    <circle cx="8" cy="8" r="2" />
                  </svg>
                )}
              </button>
            </div>

            {/* Row B — "再输一次". The eye toggle on row A above
                controls showPassword for both rows. */}
            <div
              className="auth-screen__pin-row"
              onClick={() => confirmRef.current?.focus()}
            >
              <span className="auth-screen__pin-row-label">再输一次</span>
              <div className="auth-screen__pin">
                {Array.from({ length: PASSWORD_LENGTH }).map((_, i) => {
                  // See row A note — caret only on focused row.
                  const isCursor =
                    focusedRow === 'confirm' &&
                    i === confirm.length &&
                    confirm.length < PASSWORD_LENGTH;
                  const isFilled = i < confirm.length;
                  const isShown = isFilled && showPassword;
                  const stateClass = isCursor
                    ? 'auth-screen__pin-dot--cursor'
                    : isFilled
                      ? 'auth-screen__pin-dot--filled'
                      : '';
                  return (
                    <span
                      key={i}
                      className={`auth-screen__pin-dot ${stateClass}`.trim()}
                      data-state={isCursor ? 'cursor' : isFilled ? 'filled' : 'empty'}
                    >
                      {isShown ? confirm[i] : isFilled ? '•' : ''}
                    </span>
                  );
                })}
              </div>
            </div>

            
            {/* Hidden inputs — the capture surfaces. maxLength caps
                the value at PASSWORD_LENGTH on both, so neither
                row can overflow. type toggles between password /
                text via showPassword. onFocus/onBlur drive
                `focusedRow` so only the active row renders its
                caret + dark underline. */}
            <input
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              inputMode="text"
              autoComplete="new-password"
              maxLength={PASSWORD_LENGTH}
              aria-label="密码"
              value={password}
              onChange={onPasswordChange}
              onFocus={() => setFocusedRow('password')}
              onBlur={() => setFocusedRow((cur) => (cur === 'password' ? null : cur))}
              className="auth-screen__pin-input"
            />
            <input
              ref={confirmRef}
              type={showPassword ? 'text' : 'password'}
              inputMode="text"
              autoComplete="new-password"
              maxLength={PASSWORD_LENGTH}
              aria-label="确认密码"
              value={confirm}
              onChange={onConfirmChange}
              onFocus={() => setFocusedRow('confirm')}
              onBlur={() => setFocusedRow((cur) => (cur === 'confirm' ? null : cur))}
              className="auth-screen__pin-input"
            />

            {/* Live match hint — flips between idle / match /
                mismatch as the user types. aria-live=polite so
                screen readers announce the state change. */}
            {matchHint.tone !== 'empty' || matchHint.zh ? (
              <span
                className={`auth-screen__match-hint auth-screen__match-hint--${matchHint.tone}`}
                aria-live="polite"
                lang="zh"
              >
                {matchHint.zh}
              </span>
            ) : null}

            {errors.password || errors.confirm ? (
              <span className="auth-field__error" role="alert">
                {errors.password ?? errors.confirm}
              </span>
            ) : null}

            <button
              type="submit"
              disabled={!canAdvanceFromScreen2}
              className="auth-screen__next"
              aria-label="注册"
            >
              <span className="auth-screen__next-arrow" aria-hidden="true">
                →
              </span>
            </button>

            <div className="auth-screen__progress" aria-hidden="true">
              <span className="auth-screen__dot" data-active="false" />
              <span className="auth-screen__dot" data-active="true" />
            </div>
          </div>
        </div>

        <p className="auth-form__alt">
          已有账号？
          <Link
            href={
              fromParam
                ? `/login?from=${encodeURIComponent(fromParam)}`
                : '/login'
            }
          >
            登录
          </Link>
        </p>

        {/* CSS lives here (not in globals.css) so it ships only on
            the auth pages. Using dangerouslySetInnerHTML is
            intentional: with `<style>{css}</style>` the JSX child
            gets re-stringified at hydration time and any whitespace
            difference between server and client (e.g. trailing
            newline handling) blows up with "Text content does not
            match server-rendered HTML". dangerouslySetInnerHTML
            passes the bytes through verbatim — no re-stringification,
            no mismatch. */}
        <style dangerouslySetInnerHTML={{ __html: `
          .auth-form-shake-wrap {
            /* disabled per user: */ /* animation: auth-form-shake 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both; */
          }
          @keyframes auth-form-shake {
            0%, 100% { /* transform: translateX(0); */ }
            20%      { /* transform: translateX(-6px); */ }
            40%      { /* transform: translateX(6px); */ }
            60%      { /* transform: translateX(-4px); */ }
            80%      { /* transform: translateX(4px); */ }
          }
          .auth-form--dissolving {
            opacity: 0;
            transform: scale(0.96);
            pointer-events: none;
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
          .auth-form__alt {
            text-align: center;
            font-size: var(--type-caption);
            color: var(--auth-subheading);
            margin: 0;
          }
          .auth-form__alt a {
            color: var(--accent);
            text-decoration: none;
            font-weight: var(--type-body-emphasis-weight);
            position: relative;
            display: inline-block;
          }
          .auth-form__alt a::after,
          .auth-form__alt a::before {
            content: "";
            position: absolute;
            left: 0;
            right: 0;
            bottom: -2px;
            height: 1px;
            background: currentColor;
            transform: scaleX(0);
            transform-origin: center;
            transition: transform 200ms var(--ease-standard);
          }
          .auth-form__alt a::before { transform-origin: left; }
          .auth-form__alt a::after  { transform-origin: right; }
          .auth-form__alt a:hover::before { transform: scaleX(1); height: 2px; bottom: -3px; }
          .auth-form__alt a:hover::after  { transform: scaleX(1); height: 2px; bottom: -3px; }

          /* -------------------------------------------------------------
             auth-screen (Screen 1 — email)
             ------------------------------------------------------------- */
          .auth-screen {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
            transition: opacity 200ms var(--ease-standard),
                        transform 200ms var(--ease-standard);
          }
          .auth-screen__stage {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
            position: relative;
          }
          .auth-screen__subtitle {
            position: relative;
            display: block;
            min-height: 1.6em;
            font-size: var(--type-body);
            color: var(--auth-subheading);
            margin: 0;
            margin-top: calc(var(--space-4) * -1 + var(--space-1));
            animation: auth-subtitle-fade 200ms var(--ease-standard) 700ms both;
          }
          .auth-screen__subtitle-line {
            position: absolute;
            left: 0;
            right: 0;
            top: 0;
            opacity: 0;
            transform: translateY(4px);
            transition: opacity 400ms var(--ease-standard),
                        transform 400ms var(--ease-standard);
          }
          .auth-screen__subtitle-line[data-active="true"] {
            opacity: 1;
            transform: translateY(0);
          }
          .auth-screen__zh-large {
            font-family: var(--font-body);
            font-size: clamp(32px, 5vw, 42px);
            font-weight: 700;
            color: var(--auth-heading);
            text-align: center;
            letter-spacing: -0.01em;
            line-height: 1.2;
            margin: var(--space-1) auto var(--space-2);
            opacity: 0;
            animation: auth-screen-zh-large-fade-in 480ms var(--ease-emphasized) 1300ms both;
          }
          .auth-screen__en-hint {
            display: inline-flex;
            justify-content: center;
            align-items: baseline;
            gap: 0.04em;
            font-family: var(--font-mono);
            font-size: clamp(18px, 2vw, 22px);
            font-weight: 500;
            color: var(--auth-subheading);
            letter-spacing: 0.02em;
            line-height: 1.2;
            margin: 0 auto var(--space-4);
            opacity: 0;
            animation: auth-screen-en-hint-fade-in 320ms var(--ease-standard) 1700ms both;
          }
          .auth-screen__input {
            width: 100%;
            height: 44px;
            padding: 0 var(--space-3);
            font-family: var(--font-mono);
            font-size: var(--type-body);
            font-weight: 500;
            color: var(--auth-heading);
            background: var(--auth-input-bg);
            border: 0;
            border-bottom: 2px solid var(--auth-input-border);
            border-radius: 0;
            letter-spacing: 0.02em;
            caret-color: var(--cm-mint-deep);
            transition: border-bottom-color var(--duration-fast) var(--ease-standard);
            position: relative;
          }
          .auth-screen__input::placeholder {
            color: var(--cm-ink-soft);
            font-family: var(--font-body);
          }
          .auth-screen__input:hover {
            border-bottom-color: var(--auth-input-border-focus);
          }
          .auth-screen__input:focus {
            outline: none;
            border-bottom-color: var(--auth-input-border-focus);
          }
          .auth-screen__input::after {
            content: "";
            position: absolute;
            left: var(--space-3);
            right: var(--space-3);
            bottom: -1px;
            height: 2px;
            background: var(--auth-input-border-focus);
            transform: scaleX(0);
            transform-origin: left center;
          }
          .auth-screen__input:focus::after {
            animation: auth-screen-underline-grow var(--duration-base) var(--ease-emphasized) forwards;
          }
          .auth-screen__next {
            align-self: flex-end;
            margin-top: var(--space-2);
            width: 56px;
            height: 56px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-family: var(--font-body);
            font-size: 22px;
            font-weight: 500;
            line-height: 1;
            color: var(--auth-heading);
            background: rgba(63, 209, 122, 0.10);
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: var(--radius-md);
            padding: 0;
            cursor: pointer;
            transition: background var(--duration-fast) var(--ease-standard),
                        border-color var(--duration-fast) var(--ease-standard),
                        transform var(--duration-fast) var(--ease-standard),
                        opacity var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__next-arrow {
            display: inline-block;
            transform: translateX(0);
            transition: transform var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__next:hover:not([disabled]) {
            background: var(--auth-cta-bg);
            border-color: rgba(0, 0, 0, 0.16);
          }
          .auth-screen__next:hover:not([disabled]) .auth-screen__next-arrow {
            transform: translateX(2px);
          }
          .auth-screen__next:active:not([disabled]) {
            transform: scale(0.96);
          }
          .auth-screen__next:focus-visible {
            outline: 2px solid var(--auth-heading);
            outline-offset: 3px;
          }
          .auth-screen__next[disabled] {
            opacity: 0.3;
            pointer-events: none;
          }
          /* .auth-screen__progress + .auth-screen__dot + data-active
             moved to globals.css. Inline <style> var() resolution
             failed in Next.js dev mode (same root cause as the PIN
             underline issue documented in design-auth.md §5) — the
             token var() resolved to rgba(0,0,0,0), leaving the dots
             transparent. The external stylesheet applies the rule
             reliably, with hardcoded mint colors so var() isn't
             needed. */

          /* -------------------------------------------------------------
             Screen 2 — password + confirm: back button + 2 PIN rows +
             show/hide toggle + match hint.
             ------------------------------------------------------------- */
          .auth-screen__back {
            position: absolute;
            top: 0;
            left: 0;
            width: 36px;
            height: 36px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            line-height: 1;
            color: var(--auth-subheading);
            background: transparent;
            border: 0;
            border-radius: var(--radius-sm);
            padding: 0;
            cursor: pointer;
            transition: color var(--duration-fast) var(--ease-standard),
                        background var(--duration-fast) var(--ease-standard),
                        transform var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__back:hover {
            color: var(--auth-heading);
            background: rgba(63, 209, 122, 0.10);
          }
          .auth-screen__back:active {
            transform: scale(0.94);
          }
          .auth-screen__back:focus-visible {
            outline: 2px solid var(--auth-heading);
            outline-offset: 2px;
          }

          /* PIN row — labeled wrapper for one of the two PIN rows on
             Screen 2. Holds the row label + the dots. Clicks focus
             the matching hidden input. */
          .auth-screen__pin-row {
            display: flex;
            flex-direction: column;
            align-items: center;
            /* Negative 2px gap overlaps the label and the dot row by
               2px. The label's bottom padding is 0, so the label
               sits 2px inside the dot row's top. */
            gap: -2px;
            padding: 8px 0 var(--space-1);
            cursor: text;
            user-select: none;
            /* Anchor for the absolutely-positioned eye toggle (row A
               only — row B has no toggle). */
            position: relative;
          }
          .auth-screen__pin-row-label {
            font-size: var(--type-caption);
            color: var(--auth-subheading);
            letter-spacing: 0.02em;
            /* No bottom padding — the label-to-dots gap is purely
               the -2px flex gap. Horizontal padding keeps the
               label text from touching the screen edge. */
            padding: var(--space-1) var(--space-3) 0;
            text-align: center;
          }
          .auth-screen__pin {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-2) 0;
            /* Right padding reserves space for the absolute-positioned
               eye toggle on the right edge of row A's wrapper. */
            padding-right: 44px;
            /* Anchor for the absolutely-positioned eye toggle. */
            position: relative;
          }
          /* .auth-screen__pin-dot + modifiers + ::after moved to globals.css */
          /* Hidden text inputs — capture surfaces for the two PIN
             rows. Visually invisible but focusable. */
          .auth-screen__pin-input {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            pointer-events: none;
            left: -9999px;
            top: -9999px;
          }

          /* Show/hide toggle — single button for the password row only
             (the confirm row has no toggle). Anchored to the right
             edge of row A's .auth-screen__pin-row, vertically
             centered. Absolute so it doesn't disrupt the dots'
             flex layout. The .auth-screen__pin row reserves 44px of
             right padding so the dots never overlap the toggle. */
          .auth-screen__show-toggle {
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            background: transparent;
            border: 0;
            border-radius: var(--radius-sm);
            color: var(--cm-ink-soft);
            padding: 0;
            cursor: pointer;
            transition: color var(--duration-fast) var(--ease-standard),
                        background var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__show-toggle:hover {
            color: var(--auth-input-border-focus);
            background: rgba(63, 209, 122, 0.10);
          }
          .auth-screen__show-toggle:focus-visible {
            outline: 2px solid var(--auth-heading);
            outline-offset: 1px;
          }

          /* Live match hint — flips between empty / incomplete /
             match / mismatch as the user types both rows. The
             incomplete and mismatch tones use var(--accent) (warm
             red) with a leading ⚠ glyph for visual weight. The
             match tone uses var(--correct) (sage green) with a ✓
             glyph. */
          .auth-screen__match-hint {
            display: inline-flex;
            align-self: center;
            align-items: center;
            gap: 6px;
            font-size: var(--type-caption);
            color: var(--auth-subheading);
            letter-spacing: 0.02em;
            min-height: 1.4em;
            transition: color var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__match-hint--incomplete,
          .auth-screen__match-hint--mismatch {
            color: var(--accent);
          }
          .auth-screen__match-hint--match {
            color: var(--correct);
          }
          /* Leading glyph: ⚠ for incomplete/mismatch, ✓ for match.
             Rendered via ::before on the span so the JSX stays a
             single text node. */
          .auth-screen__match-hint--incomplete::before {
            content: "⚠";
            font-size: 13px;
          }
          .auth-screen__match-hint--mismatch::before {
            content: "⚠";
            font-size: 13px;
          }
          .auth-screen__match-hint--match::before {
            content: "✓";
            font-size: 13px;
          }

          /* Per-screen pane — see login's identical block. */
          .auth-screen__pane {
            position: absolute;
            inset: 0;
            opacity: 0;
            transform: translateY(0);
            pointer-events: none;
            transition: opacity 240ms var(--ease-standard);
          }
          .auth-screen__pane[data-active="true"] {
            position: static;
            opacity: 1;
            pointer-events: auto;
            animation: auth-screen-pane-enter 320ms var(--ease-emphasized) 100ms both;
          }

          @keyframes auth-subtitle-fade {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes auth-screen-zh-large-fade-in {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 0.85; transform: translateY(0); }
          }
          @keyframes auth-screen-en-hint-fade-in {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 0.55; transform: translateY(0); }
          }
          @keyframes auth-screen-pane-enter {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes auth-screen-underline-grow {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          /* @keyframes auth-screen-dot-fill + auth-screen-fade-in moved to
             globals.css alongside the dot rule. */

          @media (prefers-reduced-motion: reduce) {
            .auth-form-shake-wrap { animation: none !important; }
            .auth-screen { transition: none !important; }
            .auth-screen__subtitle { animation: none !important; opacity: 1; transform: none; }
            .auth-screen__zh-large { animation: none !important; opacity: 0.85; transform: none; }
            .auth-screen__en-hint { animation: none !important; opacity: 0.55; transform: none; }
            .auth-screen__pane { transition: none !important; }
            .auth-screen__pane[data-active="true"] { animation: none !important; transform: none; }
            .auth-screen__input::after { animation: none !important; transform: scaleX(1); }
            .auth-screen__next { transition: none !important; }
            .auth-screen__next-arrow { transition: none !important; }
            .auth-screen__dot { transition: none !important; }
            .auth-screen__dot[data-active="true"] { animation: none !important; transform: scale(1); }
            .auth-screen__progress { animation: none !important; opacity: 1; }
            .auth-screen__back { transition: none !important; }
            .auth-screen__pin-dot { transition: none !important; }
            .auth-screen__show-toggle { transition: none !important; }
            .auth-screen__pin-dot--cursor::after { animation: none !important; opacity: 1; }
            .auth-screen__match-hint { transition: none !important; }
          }
        ` }} />
      </form>
    </div>
  );
}
