'use client';

/**
 * /login — step-by-step reveal sign-in UI.
 *
 * Each field gets its own screen (1=email, 2=password, 3=review+submit).
 * The English word is the visual hero on each screen, with the Chinese
 * translation directly underneath; the user types into a single
 * underline-only input below. This PR delivers Screen 1 (email);
 * Screens 2 and 3 are placeholder stubs so the state plumbing is
 * ready for the next PR.
 *
 * Implementation notes:
 *   - Title 4 chars × 120ms stagger (existing auth-char-rise).
 *   - Subtitle static line; 4-state focus machine is dropped on Screen 1
 *     (one input only — no focus-state copy variants).
 *   - Word char-by-char typewriter: each char span flips opacity
 *     0.30 ↔ 1.0 as the user types matching chars; full match
 *     triggers a 240ms "seal" border around the word.
 *   - Real-time email validation on change; Next button disabled
 *     until email is valid + non-empty.
 *   - Card shake on submit error (key-based re-trigger) — same
 *     pattern as before, now also bounces the user back to the
 *     offending screen if a server field error arrives.
 *   - Success dissolve (Screen 3, future): card scale 0.96 + fade,
 *     200ms hold, then nav. Wired but unreachable in this PR.
 *   - Reduced-motion: all motion disabled.
 *
 * API:
 *   POST /api/auth/login { email, password } → UserPublic + Set-Cookie.
 *   On success, refresh() the AuthProvider so the top chrome swaps
 *   login pill → avatar before the route changes.
 */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  ChangeEvent,
  FocusEvent,
  FormEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { apiLogin, ApiError } from '../../api';
import { useAuth } from '../../lib/auth';
import { safeRedirectPath } from '../../lib/safeRedirect';

interface FieldErrors {
  email?: string;
  password?: string;
}

/**
 * Suspense shell — required by Next.js 14 for any page that calls
 * useSearchParams(). Without this, the page bails to the not-found
 * boundary during the initial render. The fallback is a thin
 * placeholder with the same card-rise animation so there's no flash
 * between hydration and the form appearing.
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
  const { refresh } = useAuth();
  // Read ?from= once on mount. safeRedirectPath() defends against
  // open-redirect attacks (e.g. /login?from=https://evil.com). When
  // absent or invalid, the fallback '/' kicks in.
  const fromParam = searchParams?.get('from') ?? null;
  const redirectTo = safeRedirectPath(fromParam, '/');
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

  // Screen-by-screen flow state. 1 = email (in this PR), 2 = password,
  // 3 = review + submit. Screen transitions are exclusive — only one
  // stage renders at a time. Server errors during Screen 3 submit
  // bounce the user back to the offending screen via setScreen().
  const [screen, setScreen] = useState<1 | 2>(1);

  // Subtitle carousel — each screen has its own CN+EN pair so the
  // prompt matches what the user is currently doing. Picked
  // deliberately so the auth page reads as a tiny preview of the
  // product's "see Chinese, write English" loop without forcing
  // the user to actually type. Index flips on a 2s timer set up
  // in the effect below.
  //
  // Per-screen content:
  //   Screen 1 (email)   — 请告诉我你的邮箱 / Please tell me your email
  //   Screen 2 (password)— 现在告诉我你的密码 / Now tell me your password
  const SUBTITLE_LINES_BY_SCREEN: Record<1 | 2, readonly { lang: 'zh' | 'en'; text: string }[]> = {
    1: [
      { lang: 'zh', text: '请输入邮箱' },
      { lang: 'en', text: 'Enter your email' },
    ],
    2: [
      { lang: 'zh', text: '请输入密码' },
      { lang: 'en', text: 'Enter your password' },
    ],
  };
  // Resolved at render time so the JSX below always sees the pair
  // for the currently active screen.
  const subtitleLines = SUBTITLE_LINES_BY_SCREEN[screen];
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  // Reset the index to 0 every time the screen changes, so a quick
  // jump from Screen 2 → 1 → 2 doesn't carry the user mid-fade from
  // the prior pass. The setTimeout(0) defers the reset past the same
  // tick the screen switch commits, so the new line first renders
  // with index 0 (CN), then the interval below takes over.
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

  const validateEmail = useCallback((value: string): string | null => {
    if (!value) return null;
    // Pragmatic regex — not RFC 5322 perfect, but matches the
    // "looks like an email" cases and rejects obvious typos.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return '邮箱格式不正确';
    }
    return null;
  }, []);

  // Trigger card shake + bounce the user to the offending screen
  // whenever a new error arrives. Server-side errors land here after
  // a Screen 2 submit and need to drop the user back to the matching
  // input; client-side errors (e.g. submit with empty email/password)
  // also route through this effect.
  useEffect(() => {
    const hasErrors = Object.values(errors).some(Boolean);
    if (!hasErrors) return;
    setShakeKey((k) => k + 1);
    if (errors.email) {
      setScreen(1);
      requestAnimationFrame(() => emailRef.current?.focus());
    } else if (errors.password) {
      setScreen(2);
      requestAnimationFrame(() => passwordRef.current?.focus());
    }
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Only Screen 2's Next button (type="submit") should ever reach
    // here. A stray Enter on the email input on Screen 1 must NOT
    // hit the API — guard explicitly so we don't 400 with an empty
    // password. The Next button is also disabled when the password
    // is too short, but the guard is defense in depth.
    if (screen !== 2) return;
    if (submitting || dissolving) return;

    // Run client-side validation first — don't bother the server if
    // the local state is already wrong.
    const localEmailError = validateEmail(email);
    if (localEmailError) {
      setEmailFormatError(localEmailError);
      setShakeKey((k) => k + 1);
      setScreen(1);
      requestAnimationFrame(() => emailRef.current?.focus());
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
      // Pull the new user into AuthProvider before the chrome swaps
      // anonymous → signed-in. Without this, the avatar would only
      // appear after the next page's mount fires /me.
      await refresh();
      // Land on the page the user came from (/?lib=X if they were
      // practicing), or `/` if no `?from=` was supplied.
      router.replace(redirectTo);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as FieldErrors);
        // Bounce back to the offending screen — the useEffect on
        // [errors] will refocus the field automatically.
        if (apiErr.fieldErrors.email) setScreen(1);
        else if (apiErr.fieldErrors.password) setScreen(2);
      } else {
        setErrors({ email: apiErr.message ?? '登录失败' });
        setScreen(1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Email error precedence: server field error wins over client format
  // error (the server has the final say on whether this email exists).
  const emailError = errors.email || emailFormatError;

  // Screen 1 advance gate — Next is enabled only when email is
  // syntactically valid AND non-empty. Empty + invalid format both
  // keep Next disabled (opacity 0.4, no pointer).
  const canAdvanceFromScreen1 =
    email.length > 0 && emailFormatError === null;

  // Screen 2 advance gate — Next is enabled only when the user has
  // entered a PASSWORD_LENGTH-char password. Browser maxLength on the
  // hidden input already caps the value at PASSWORD_LENGTH, so a
  // simple length check is enough. PASSWORD_LENGTH is 8 to match
  // the backend's password min_length=8 and to stay in lockstep
  // with the signup page.
  const PASSWORD_LENGTH = 8;
  const canAdvanceFromScreen2 = password.length >= PASSWORD_LENGTH;

  // Per-screen canAdvance — picked by current screen. Used to drive
  // the disabled state of the Next button on every screen.
  function canAdvanceForCurrentScreen(): boolean {
    if (screen === 1) return canAdvanceFromScreen1;
    if (screen === 2) return canAdvanceFromScreen2;
    return true; // Screen 3's Next is the submit trigger; always enabled
  }

  // Screen 1 event handlers. Typed buffer mirrors email on Screen 1
  function onEmailChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setEmail(next);
    if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
    if (emailFormatError) setEmailFormatError(validateEmail(next));
  }

  function onEmailFocus() {
    // No-op on Screen 1 — subtitle is static, no focus-state copy.
  }

  // Password change — mirrors onEmailChange in spirit. We don't run
  // client-side format validation on passwords (no length error in
  // advance — the gate is purely on character count via
  // canAdvanceFromScreen2). Server errors land in errors.password
  // and the [errors] effect bounces the user back to Screen 2.
  function onPasswordChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setPassword(next);
    if (errors.password) {
      setErrors((p) => ({ ...p, password: undefined }));
    }
  }

  function onEmailBlur(e: FocusEvent<HTMLInputElement>) {
    setEmailFormatError(validateEmail(e.target.value));
  }

  function onNext() {
    // Screen 1: advance to password (gate on valid + non-empty email)
    if (screen === 1) {
      if (!canAdvanceFromScreen1) return;
      setScreen(2);
      // Soft-focus the password input on the next frame, after React
      // has committed the screen-2 JSX. Without this, passwordRef
      // would still point at a stale (not-yet-mounted) node.
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }
    // Screen 2: Next IS the submit button. It carries type="submit"
    // and lives inside the form, so clicking it triggers the form's
    // onSubmit handler. The [errors] bounce effect handles any
    // server-side errors that come back.
    if (screen === 2 && !canAdvanceFromScreen2) return;
    // (No explicit submit call here — the button is type="submit".)
  }

  // Back from Screen 2 → Screen 1. State (email + password) is
  // preserved — the inputs re-mount on the active pane and the
  // already-filled slots show the masked glyph / typed char.
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

        {/* Subtitle — a 2s fade carousel alternating between the CN
            and EN phrasing of the same line. Both spans stay in the
            DOM (one absolute, one static) so the swap doesn't cause
            layout reflow. Only the visible one has data-active="true"
            and gets opacity 1; the other is opacity 0. The cross-fade
            uses the same auth-subtitle-fade keyframe as before. */}
        <div className="auth-screen__subtitle" aria-live="polite">
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

        {/* All three screen panes are mounted simultaneously. Only one
            has data-active="true"; the others are inert (opacity 0,
            pointer-events: none) and cross-fade via the
            auth-screen__pane transition. This avoids the "hard cut"
            of conditional rendering and gives the eye a continuous
            path from one step to the next. */}
        <div className="auth-screen__pane" data-active={screen === 1 ? 'true' : 'false'}>
          <EmailScreen
            email={email}
            emailError={emailError}
            canAdvance={canAdvanceFromScreen1}
            inputRef={emailRef}
            onChange={onEmailChange}
            onFocus={onEmailFocus}
            onBlur={onEmailBlur}
            onNext={onNext}
          />
        </div>

        <div className="auth-screen__pane" data-active={screen === 2 ? 'true' : 'false'}>
          <PasswordScreen
            password={password}
            passwordError={errors.password}
            canAdvance={canAdvanceFromScreen2}
            inputRef={passwordRef}
            onChange={onPasswordChange}
            onPrev={onPrev}
            onNext={onNext}
            showPassword={showPassword}
            onToggleShow={() => {
              setShowPassword((v) => !v);
              // After toggling, return focus to the hidden input.
              // The button steals focus on click, which makes
              // backspace trigger the button's pressed animation
              // instead of deleting a character. We also set the
              // selection range to the end of the value because
              // React's re-render on type/password toggle can reset
              // the caret to position 0.
              requestAnimationFrame(() => {
                const el = passwordRef.current;
                if (el && document.activeElement !== el) {
                  el.focus();
                  const end = el.value.length;
                  try {
                    el.setSelectionRange(end, end);
                  } catch {
                    /* setSelectionRange can throw on type=password
                       inputs in some browsers — ignore */
                  }
                }
              });
            }}
            pinLength={PASSWORD_LENGTH}
          />
        </div>

        <p className="auth-form__alt">
          还没有账号？
          <Link
            href={
              fromParam
                ? `/signup?from=${encodeURIComponent(fromParam)}`
                : '/signup'
            }
          >
            注册
          </Link>
        </p>

        {/* CSS lives here (not in globals.css) so it ships only on
            the auth pages — keeps the read-layer's main bundle
            small and lets us iterate on auth visuals without
            touching the design system.

            Using dangerouslySetInnerHTML is intentional: with
            `<style>{css}</style>` the JSX child gets re-stringified
            at hydration time and any whitespace difference between
            server and client (e.g. trailing newline handling) blows
            up with "Text content does not match server-rendered
            HTML". dangerouslySetInnerHTML passes the bytes through
            verbatim — no re-stringification, no mismatch. */}
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
            /* Slow fade-in: 4px translateY over 400ms, ease-standard.
               Single shared animation, no stagger between fields —
               they all appear together to feel like one "form
               reveal" rather than fields bouncing in one by one. */
            animation: auth-field-rise 400ms var(--ease-standard) both;
          }
          /* (Stagger .auth-field-1/2 rules removed — fields share one
             animation now. Kept the class names on the JSX so future
             tweaks can re-add per-field delay if needed.) */
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
          .auth-field__input-wrap:focus-within .auth-field__input--error,
          .auth-field__input-wrap[data-state="error"] .auth-field__input {
            border-color: var(--accent);
            box-shadow: 0 0 0 4px rgba(215, 0, 21, 0.10);
            /* disabled per user: */ /* animation: auth-field-error-attn 240ms var(--ease-standard) both; */
          }
          /* Confirmed state (data-state="confirmed"): green border + soft
             glow. Sits on top of focus state for visual layering. */
          .auth-field__input-wrap[data-state="confirmed"] .auth-field__input {
            border-color: var(--correct);
            background: rgba(92, 122, 74, 0.04);
          }
          .auth-field__input-wrap[data-state="confirmed"] .auth-field__icon {
            color: var(--correct);
          }
          @keyframes auth-field-error-attn {
            0%, 100% { /* transform: translateX(0); */ }
            30%      { /* transform: translateX(-2px); */ }
            70%      { /* transform: translateX(2px); */ }
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
          /* .auth-form__submit rules removed — the submit button is gone
             in the screen-by-screen flow. Re-enable when Screen 3 lands. */
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
            margin: 0;
          }
          .auth-form__alt a {
            color: var(--accent);
            text-decoration: none;
            font-weight: var(--type-body-emphasis-weight);
            position: relative;
            display: inline-block;
          }
          /* Underline expand-from-center: 1px line at rest grows to
             2px on hover, animated from scaleX(0) to scaleX(1) over
             200ms. The two halves are pseudo-elements that meet at
             the middle — feels like the link is "underlining itself"
             in response to the cursor. */
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

          /* .auth-form__subtitle rule removed — replaced by
             .auth-screen__subtitle in the new Screen 1 block. */
          @keyframes auth-subtitle-fade {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          /* -------------------------------------------------------------
             auth-screen (Screen 1 — email)
             Replaces .auth-form. Single-screen layout with a hero EN
             word, ZH translation, underline-only input, Next button,
             and 3-dot progress indicator. Screens 2 and 3 reuse
             .auth-screen shell but render their own .auth-screen__stage
             contents (those are placeholders in this PR).
             ------------------------------------------------------------- */
          .auth-screen {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
            transition: opacity 200ms var(--ease-standard),
                        transform 200ms var(--ease-standard);
          }
          .auth-screen--dissolving {
            opacity: 0;
            transform: scale(0.96);
            pointer-events: none;
          }
          /* Per-screen stage wrapper — the visible content for one
             screen (word + ZH + input + Next + progress). */
          .auth-screen__stage {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
            /* Pane positioning context — see .auth-screen__pane.
               Inactive panes are absolutely positioned on top of the
               stage so they don't take up vertical space (otherwise
               Screen 2 / 3 placeholder text would push the layout
               down and create a big blank gap). The active pane
               snaps to position:static to size the stage. Also the
               anchor for the .auth-screen__back absolute child. */
            position: relative;
          }

          /* Back button — top-left of the stage, absolutely
             positioned so it doesn't push the rest of the content
             down. Same hover/active/focus treatment as the eye
             toggle so the two icon buttons feel like a family. */
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
            color: var(--label-tertiary);
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
            color: var(--label-primary);
            background: rgba(0, 0, 0, 0.04);
          }
          .auth-screen__back:active {
            transform: scale(0.94);
          }
          .auth-screen__back:focus-visible {
            outline: 2px solid var(--label-primary);
            outline-offset: 2px;
          }

          /* Subtitle — a 2s fade carousel alternating between a CN
             line and its EN translation. The wrapper is positioned
             relative so the two absolute children can stack; only the
             one with data-active="true" gets opacity 1 + translateY(0),
             the other is opacity 0 + translateY(4px) (slides up as it
             enters, slides down as it leaves). min-height locks the
             row so the hero text below doesn't shift on swap. */
          .auth-screen__subtitle {
            position: relative;
            display: block;
            min-height: 1.6em;
            font-size: var(--type-body);
            color: var(--label-tertiary);
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
          /* Word hierarchy: hero CN + hint EN. CN is the visual hero
             (32-42px body, label-primary, opacity 0.85); EN is a
             typewriter hint (18-22px mono, label-tertiary,
             opacity 0.55). The earlier uppercase eyebrow marker was
             dropped — the carousel subtitle and the CN hero carry
             enough context on their own. */
          .auth-screen__zh-large {
            font-family: var(--font-body);
            font-size: clamp(32px, 5vw, 42px);
            font-weight: 700;
            color: var(--label-primary);
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
            color: var(--label-tertiary);
            letter-spacing: 0.02em;
            line-height: 1.2;
            margin: 0 auto var(--space-4);
            opacity: 0;
            animation: auth-screen-en-hint-fade-in 320ms var(--ease-standard) 1700ms both;
          }
          /* Per-char span inside .auth-screen__en-hint. Default dim
             (0.55 to remain readable at the smaller font); matched
             chars flip to 1.0 with 80ms transition for immediate
             typing feedback. */
          /* Underline-only input — transparent bg, no border. Always
             shows a 1px underline (the resting state uses
             --label-tertiary so it's actually visible — earlier
             versions used --label-quaternary which was too light to
             read). On focus the input's own underline stays in
             place (no longer transparent) and a 2px black
             ::after overlay animates in from the left, layered ON
             TOP of the resting underline for emphasis. */
          .auth-screen__input {
            width: 100%;
            height: 44px;
            padding: 0 var(--space-2);
            font-family: var(--font-mono);
            font-size: var(--type-body);
            font-weight: 500;
            color: var(--label-primary);
            background: transparent;
            border: 0;
            border-bottom: 1px solid var(--label-tertiary);
            border-radius: 0;
            letter-spacing: 0.02em;
            caret-color: var(--label-primary);
            transition: border-bottom-color var(--duration-fast) var(--ease-standard);
            position: relative;
          }
          .auth-screen__input::placeholder {
            color: var(--label-quaternary);
            font-family: var(--font-body);
          }
          /* Hover: nudge the underline slightly darker so the user
             feels the field is interactive. */
          .auth-screen__input:hover {
            border-bottom-color: var(--label-secondary);
          }
          /* Focus: the resting 1px underline shifts toward black
             while the 2px overlay animates in. Both visible —
             no more "underline disappears on focus" surprise. */
          .auth-screen__input:focus {
            outline: none;
            border-bottom-color: var(--label-secondary);
          }
          /* Focus overlay — a 2px black pseudo-element that animates
             in from the left over 350ms when the input is focused.
             Sits 1px below the input's bottom edge (bottom: -1px)
             so it lands right under the input's 1px underline,
             forming a clear "taller, bold" focus state without
             obscuring the resting underline. Resting state is
             hidden by scaleX(0). */
          .auth-screen__input::after {
            content: "";
            position: absolute;
            left: var(--space-2);
            right: var(--space-2);
            bottom: -1px;
            height: 2px;
            background: var(--label-primary);
            transform: scaleX(0);
            transform-origin: left center;
          }
          .auth-screen__input:focus::after {
            animation: auth-screen-underline-grow var(--duration-base) var(--ease-emphasized) forwards;
          }
          /* Next button — icon-only square button with a single arrow.
             No text label (decorative; aria-label on the <button> carries
             the accessible name). Disabled = opacity 0.3 + no pointer,
             matches the convention the rest of the auth flow uses. */
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
            color: var(--label-primary);
            background: rgba(0, 0, 0, 0.04);
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
            background: rgba(0, 0, 0, 0.08);
            border-color: rgba(0, 0, 0, 0.16);
          }
          .auth-screen__next:hover:not([disabled]) .auth-screen__next-arrow {
            transform: translateX(2px);
          }
          .auth-screen__next:active:not([disabled]) {
            transform: scale(0.96);
          }
          .auth-screen__next:focus-visible {
            outline: 2px solid var(--label-primary);
            outline-offset: 3px;
          }
          .auth-screen__next[disabled] {
            opacity: 0.3;
            pointer-events: none;
          }
          /* 3-dot progress indicator. Active dot scales up + fills
             label-primary; inactive dots stay at label-quaternary. */
          .auth-screen__progress {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: var(--space-2);
            margin: 0;
            animation: auth-screen-fade-in 240ms var(--ease-standard) 1500ms both;
          }
          .auth-screen__dot {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--label-quaternary);
            opacity: 0.5;
            transition: background var(--duration-fast) var(--ease-standard),
                        opacity var(--duration-fast) var(--ease-standard),
                        transform var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__dot[data-active="true"] {
            background: var(--label-primary);
            opacity: 1;
            transform: scale(1.15);
            animation: auth-screen-dot-fill var(--duration-base) var(--ease-emphasized) both;
          }
          /* Screen 2 / 3 placeholders — centered muted text. */
          .auth-screen__placeholder {
            text-align: center;
            font-size: var(--type-body);
            color: var(--label-tertiary);
            padding: var(--space-5) 0;
          }

          /* -------------------------------------------------------------
             Screen 2 — password: back button + 6-dot PIN + show/hide
             toggle + hidden text input. The hidden input is the
             capture surface; the dots are derived state. Visual
             treatment mirrors Screen 1's underline-only input feel
             (no boxed borders on the row).
             ------------------------------------------------------------- */

          /* PIN row — 8 fixed dot slots centered horizontally. The row
             itself is a click target that focuses the hidden input
             below, so users can resume typing by tapping anywhere on
             the row. */
          .auth-screen__pin {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-4) 0;
            /* Right padding reserves space for the absolute-positioned
               eye toggle on the right edge of the PIN row. */
            padding-right: 44px;
            cursor: text;
            user-select: none;
            /* Anchor for the absolutely-positioned eye toggle. */
            position: relative;
          }
          /* Single PIN slot — an independent short underline (24×28
             box) that fills as the user types. Empty state: 1px gray
             underline at 50% opacity. Filled state: 2px black
             underline at full opacity. Shown state (showPassword=
             true): same filled underline + the character rendered
             above it. The flex-end layout pins the character to
             the bottom of the slot, just above the underline. */
          .auth-screen__pin-dot {
            display: inline-flex;
            align-items: flex-end;
            justify-content: center;
            width: 24px;
            height: 28px;
            border: 0;
            border-bottom: 1px solid var(--label-quaternary);
            border-radius: 0;
            background: transparent;
            opacity: 0.5;
            padding-bottom: 1px;
            font-size: 16px;
            font-family: var(--font-mono);
            color: var(--label-primary);
            transition: border-bottom-color var(--duration-fast) var(--ease-standard),
                        border-bottom-width var(--duration-fast) var(--ease-standard),
                        opacity var(--duration-fast) var(--ease-standard);
          }
          /* Filled (hidden mode, default): thicker, opaque underline. */
          .auth-screen__pin-dot--filled {
            border-bottom: 2px solid var(--label-primary);
            opacity: 1;
          }
          /* Shown mode (showPassword=true): same filled underline +
             the character is rendered above it (the existing JSX
             already produces the char when shown=true). */
          .auth-screen__pin-dot--shown {
            border-bottom: 2px solid var(--label-primary);
            opacity: 1;
          }

          /* Caret slot — the next empty position. Underline stays
             in the empty-state 1px gray, but a thin vertical bar
             (1.5×18px) sits centered above the underline, blinking
             at 1s period via the auth-screen-caret-blink keyframe.
             The bar is rendered as a ::after pseudo-element because
             the slot's own content slot is reserved for the mask
             char (a black bullet, U+2022) or the real char in
             shown mode. */
          .auth-screen__pin-dot--cursor {
            border-bottom: 1px solid var(--label-quaternary);
            opacity: 1;
          }
          .auth-screen__pin-dot--cursor::after {
            content: "";
            display: block;
            width: 1.5px;
            height: 18px;
            background: var(--label-primary);
            /* The slot is 28px tall. The 1px underline + 1px
               padding-bottom + 18px caret = 20px, leaving 8px of
               space above the caret. That space is split as ~4px
               above the caret and ~4px from the caret to the
               underline, which reads as visually centered. */
            margin-bottom: 4px;
            animation: auth-screen-caret-blink 1s steps(2, end) infinite;
          }
          @keyframes auth-screen-caret-blink {
            0%, 50%       { opacity: 1; }
            50.01%, 100%  { opacity: 0; }
          }

          /* Hidden text input that captures keystrokes. Visually
             invisible (no border, no background, no size) but still
             focusable and clickable from the PIN row above. */
          .auth-screen__pin-input {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            pointer-events: none;
            /* Pull it off-screen so screen readers still find it but
               it doesn't take up layout space. */
            left: -9999px;
            top: -9999px;
          }
          /* But when the input itself is focused (via click on the
             PIN row), it stays out of view — the visual cue is the
             dot filling, not a visible cursor. */

          /* Show/hide eye toggle. Anchored to the right edge of the PIN
             row, vertically centered. Absolute so it doesn't disrupt
             the flex layout of the dots. The .auth-screen__pin row
             reserves 44px of right padding so the dots never overlap
             the toggle. */
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
            color: var(--label-quaternary);
            padding: 0;
            cursor: pointer;
            transition: color var(--duration-fast) var(--ease-standard),
                        background var(--duration-fast) var(--ease-standard);
          }
          .auth-screen__show-toggle:hover {
            color: var(--label-secondary);
            background: rgba(0, 0, 0, 0.04);
          }
          .auth-screen__show-toggle:focus-visible {
            outline: 2px solid var(--label-primary);
            outline-offset: 1px;
          }

          /* -------------------------------------------------------------
             Per-screen pane — see .auth-screen__pane below.
             ------------------------------------------------------------- */

          /* Per-screen pane — the wrapper that holds one screen's content.
             All three panes (Screen 1, 2, 3) are mounted simultaneously
             and stacked in source order; only one has data-active="true"
             and the rest are opacity-0 + non-interactive. The transition
             on opacity gives a smooth cross-fade when the active flag
             swaps: outgoing pane fades 240ms, incoming pane delays 100ms
             and runs a 240ms fade + 8px rise for a subtle "arrived"
             feel. Total transition ~340ms. */
          .auth-screen__pane {
            /* Inactive panes are absolutely positioned on top of the
               stage (see .auth-screen__stage position:relative) so
               they don't add to the stage's height. Opacity 0 keeps
               them invisible during the cross-fade; pointer-events
               none blocks any accidental interaction with placeholder
               text. */
            position: absolute;
            inset: 0;
            opacity: 0;
            transform: translateY(0);
            pointer-events: none;
            transition: opacity 240ms var(--ease-standard);
          }
          .auth-screen__pane[data-active="true"] {
            /* Active pane snaps back to static flow so it determines
               the stage's actual height. The enter animation runs on
               top via the auth-screen-pane-enter keyframe. */
            position: static;
            opacity: 1;
            pointer-events: auto;
            animation: auth-screen-pane-enter 320ms var(--ease-emphasized) 100ms both;
          }

          /* Keyframes for Screen 1 motion. Each fade-in ends at the
             final visible opacity so post-mount state is stable. */
          @keyframes auth-screen-zh-large-fade-in {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 0.85; transform: translateY(0); }
          }
          @keyframes auth-screen-en-hint-fade-in {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 0.55; transform: translateY(0); }
          }
          /* Pane enter — 8px rise + opacity. The pane-enter animation
             re-runs each time data-active flips because the animation
             is declared on [data-active="true"] which React re-mounts
             via the attribute change. */
          @keyframes auth-screen-pane-enter {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          /* Input focus underline — scaleX from left. */
          @keyframes auth-screen-underline-grow {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          /* Progress dot fill — scale + opacity from 0 to active state. */
          @keyframes auth-screen-dot-fill {
            from { transform: scale(0.6); opacity: 0; }
            to   { transform: scale(1.15); opacity: 1; }
          }
          /* Generic fade-in (for the progress row, which has no other
             per-element animation). */
          @keyframes auth-screen-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }

          @media (prefers-reduced-motion: reduce) {
            .auth-form-shake-wrap { animation: none !important; }
            .auth-form { transition: none !important; }
            .auth-field { animation: none !important; opacity: 1; transform: none; }
            /* .auth-form__subtitle removed (replaced by .auth-screen__subtitle) */
            .auth-field__input--error { animation: none !important; }
            .auth-form__spinner { animation: none !important; }
            /* Screen 1 motion overrides — snap everything to final state. */
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
            /* Screen 2 additions — snap everything to final state. */
            .auth-screen__pin-dot { transition: none !important; }
            .auth-screen__show-toggle { transition: none !important; }
            .auth-screen__back { transition: none !important; }
            .auth-screen__pin-dot--cursor::after { animation: none !important; opacity: 1; }
          }
        ` }} />
      </form>
    </div>
  );
}

/**
 * EmailScreen — the email step of the step-by-step login flow.
 *
 * Visual hierarchy (product is "see Chinese, write English"):
 *   - Eyebrow "EMAIL" — 11px mono uppercase marker. Tells the user
 *     this is an English-input step without competing for attention.
 *   - Hero CN "邮箱" — 32-42px body font, opacity 0.85. The user
 *     reads this; it's the product's "see" half.
 *   - Hint EN "email" — 18-22px mono, opacity 0.55. The user types
 *     this; per-char spans light up to opacity 1.0 as matching chars
 *     arrive (typewriter feedback).
 *   - Underline-only input — transparent bg, no border. Focus draws
 *     a black underline from the left.
 *   - "Next →" text button (disabled until email is valid + non-empty).
 *   - 3-dot progress indicator (Screen 1 active).
 *
 * No "seal" / full-match animation: with the EN word as hint instead
 * of hero, sealing felt misplaced.
 */
function EmailScreen(props: {
  email: string;
  emailError?: string | null;
  canAdvance: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
  onNext: () => void;
}) {
  return (
    <div className="auth-screen__stage" data-screen="1">
      {/* Hero Chinese — the "see" half. Largest text on screen.
          aria-hidden because the visible word is decorative; the
          input below is the canonical element. */}
      <p className="auth-screen__zh-large" aria-hidden="true">
        邮箱
      </p>

      {/* Hint English — static label, no per-char highlight. The
          user's keystrokes are intentionally NOT matched against
          the hint — the field is just a form input, not an
          exercise. */}
      <p className="auth-screen__en-hint" aria-hidden="true">
        email
      </p>

      <input
        ref={props.inputRef}
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        aria-label="邮箱"
        aria-invalid={props.emailError ? true : undefined}
        value={props.email}
        onChange={props.onChange}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        className="auth-screen__input"
      />

      {props.emailError ? (
        <span className="auth-field__error" role="alert">
          {props.emailError}
        </span>
      ) : null}

      <button
        type="button"
        onClick={props.onNext}
        disabled={!props.canAdvance}
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
  );
}

/**
 * PasswordScreen — Screen 2 of the step-by-step login flow.
 *
 * Mirrors EmailScreen's visual language (hero CN, EN hint, icon-only
 * Next, 3-dot progress) but the input surface is a 6-dot PIN row
 * with a hidden text/password input behind it. The user types into
 * the hidden input (focused on mount), and the visual dots are
 * derived from `password.length` + `showPassword`. The eye icon
 * toggles between dots and plain chars without ever touching the
 * actual input value.
 *
 * A small ← back button sits at the top-left of the stage so the
 * user can return to Screen 1 and edit their email without
 * clearing it.
 *
 * Visual states per dot:
 *   - Empty: 1.5px label-quaternary border, transparent fill, opacity 0.5
 *   - Filled (default, hidden mode): solid label-primary fill
 *   - Filled (shown mode via eye): 1.5px label-primary border, char rendered inside
 */
function PasswordScreen(props: {
  password: string;
  passwordError?: string | null;
  canAdvance: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onPrev: () => void;
  onNext: () => void;
  showPassword: boolean;
  onToggleShow: () => void;
  pinLength: number;
}) {
  const TARGET_WORD = 'password';
  const chars = Array.from(props.password);

  return (
    <div className="auth-screen__stage" data-screen="2">
      {/* Back button — top-left of the stage, anchored absolutely
          so it doesn't push the rest of the content down. */}
      <button
        type="button"
        onClick={props.onPrev}
        className="auth-screen__back"
        aria-label="返回上一步"
      >
        <span aria-hidden="true">←</span>
      </button>
      {/* Hero CN — same scale/style as Screen 1 for visual continuity. */}
      <p className="auth-screen__zh-large" aria-hidden="true">
        密码
      </p>

      {/* EN hint — "password" in mono, dim. Static text, no per-char
          highlighting here (the PIN dots provide the dynamic feedback
          instead). */}
      <p className="auth-screen__en-hint" aria-hidden="true">
        {TARGET_WORD}
      </p>

      {/* PIN row — 6 fixed slots. Each slot fills as the user types.
          Clicking anywhere on the row focuses the hidden input so the
          user can resume typing without hunting for a target. */}
      <div
        className="auth-screen__pin"
        onClick={() => props.inputRef.current?.focus()}
      >
        {Array.from({ length: props.pinLength }).map((_, i) => {
          const isCursor = i === chars.length && chars.length < props.pinLength;
          const isFilled = i < chars.length;
          const isShown = isFilled && props.showPassword;
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
              {isShown ? chars[i] : isFilled ? '•' : ''}
            </span>
          );
        })}
      </div>

      {/* Show/hide toggle — same eye-icon pattern as signup. tabIndex=-1
          so the keyboard Tab order skips it (focus stays on the hidden
          input). Positioned absolute-right of the pin row. */}
      <button
        type="button"
        onClick={props.onToggleShow}
        className="auth-screen__show-toggle"
        aria-label={props.showPassword ? '隐藏密码' : '显示密码'}
        tabIndex={-1}
      >
        {props.showPassword ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 8 C3.5 4.5 5.5 3 8 3 s4.5 1.5 6 5 c-1.5 3.5 -3.5 5 -6 5 s-4.5 -1.5 -6 -5 z" />
            <circle cx="8" cy="8" r="2" />
            <path d="M2 2 L14 14" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 8 C3.5 4.5 5.5 3 8 3 s4.5 1.5 6 5 c-1.5 3.5 -3.5 5 -6 5 s-4.5 -1.5 -6 -5 z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        )}
      </button>

      {/* Hidden input — captures keystrokes. maxLength caps at the
          pin length so the dot row can never overflow. type toggles
          between password and text based on showPassword so password
          managers and the native last-char peek both still work. */}
      <input
        ref={props.inputRef}
        type={props.showPassword ? 'text' : 'password'}
        inputMode="text"
        autoComplete="current-password"
        maxLength={props.pinLength}
        aria-label="密码"
        aria-invalid={props.passwordError ? true : undefined}
        value={props.password}
        onChange={props.onChange}
        className="auth-screen__pin-input"
      />

      {props.passwordError ? (
        <span className="auth-field__error" role="alert">
          {props.passwordError}
        </span>
      ) : null}

      <button
        type="submit"
        disabled={!props.canAdvance}
        className="auth-screen__next"
        aria-label="登录"
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
  );
}
