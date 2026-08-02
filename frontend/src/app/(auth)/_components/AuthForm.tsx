'use client';

/**
 * AuthForm — 单页 auth 表单的共享表示层。
 *
 * 职责:
 *   - 渲染 <form>、可选双语副标、字段列表、submit Button、alt-link
 *   - 字段支持左侧 mail 图标 + 右侧眼睛 toggle (IconButton)
 *   - 把所有状态(state / errors / submitting / showPassword)交回 page
 *
 * 不做:
 *   - 不调用 apiLogin / apiSignup / useAuth / useSearchParams
 *   - 不渲染 <h1> 标题(标题 + 4 字 stagger 由 page 渲染,走 layout 的
 *     .auth-title / .auth-title__char 规则)
 *   - 不管理光标 / focus / 焦点跳转(交给 page 通过 refs + 可见 input 直接
 *     使用浏览器原生 caret)
 *
 * 设计 token: 全部 --ds-* / --space-* / --radius-* / --text-* /
 *             --dur-* / --ease-*。见 AuthForm.module.css。
 */
import {
  ChangeEvent,
  FocusEvent,
  forwardRef,
  KeyboardEvent,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import Link from 'next/link';
import Button from '../../ds/components/Button';
import IconButton from '../../ds/components/IconButton';
import styles from './AuthForm.module.css';

export type FieldName = 'email' | 'password' | 'confirm';

export interface FieldSpec {
  name: FieldName;
  type: 'email' | 'password' | 'text';
  /** aria-label(中文)。 */
  label: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'email' | 'text';
  maxLength?: number;
  /** 左侧 16×16 SVG mail 图标。 */
  withIcon?: 'mail';
  /** 右侧眼睛 toggle,仅 password / confirm 字段用。 */
  withEyeToggle?: boolean;
  /** 覆盖 type=password 时的实际 type(showPassword 翻转逻辑)。 */
  resolvedType?: 'password' | 'text';
}

export interface MatchHint {
  tone: 'empty' | 'incomplete' | 'match' | 'mismatch';
  zh: string;
}

export interface AuthFormHandle {
  /** 让外部 page 拿到 input DOM(autofocus / 失败字段重新聚焦)。 */
  focusField: (name: FieldName) => void;
}

export interface AuthFormProps {
  mode: 'login' | 'signup';
  /** 可选双语副标(静态单行 zh · en)。 */
  subtitle?: { zh: string; en: string };
  fields: readonly FieldSpec[];
  values: Record<FieldName, string>;
  /** 字段错误;key 必须 ∈ FieldName。 */
  errors: Partial<Record<FieldName, string>>;
  /** 邮箱格式客户端错误(优先级: errors.email > emailFormatError)。 */
  emailFormatError?: string | null;
  /** 全局 "不可提交" — 内部 Button 用作 disabled。 */
  formValid: boolean;
  submitting: boolean;
  showPassword: boolean;
  /** 仅 signup 用 — 实时匹配 hint。 */
  matchHint?: MatchHint;
  submitLabel: string;
  altPrompt: string;
  altCta: string;
  altHref: string;
  onChange: (name: FieldName, value: string) => void;
  onSubmit: () => void;
  onToggleShowPassword: () => void;
  /**
   * Optional escape hatch for the alt-link CTA. When set, the alt
   * link renders as a `<button>` that calls this instead of
   * `<Link href={altHref}>`. Used by AuthModal so the "no account?
   * register" / "have an account? log in" link swaps mode in-place
   * instead of navigating to /signup or /login (which would
   * unmount the modal). Pages that want a real deep link to the
   * other auth page leave this unset.
   */
  onAltClick?: () => void;
}

/**
 * MailIcon — 16×16 SVG,沿用线性 1.5 stroke 风格,跟现有 IconButton
 * 内的 eye 描边一致。Color 跟随 currentColor。
 */
function MailIcon() {
  return (
    <svg
      className={styles.icon}
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
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 4.5 L8 9 L13.5 4.5" />
    </svg>
  );
}

/**
 * EyeIcon — 16×16,与 signup 现有 SVGs 路径一致。
 */
function EyeIcon() {
  return (
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
  );
}

function EyeOffIcon() {
  return (
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
  );
}

const AuthForm = forwardRef<AuthFormHandle, AuthFormProps>(function AuthForm(
  props,
  ref,
) {
  const inputsRef = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});

  useImperativeHandle(
    ref,
    () => ({
      focusField: (name) => {
        const el = inputsRef.current[name];
        if (el) {
          el.focus();
          const end = el.value.length;
          try {
            el.setSelectionRange(end, end);
          } catch {
            /* setSelectionRange throws on type=password in some browsers */
          }
        }
      },
    }),
    [],
  );

  const onFieldChange = useCallback(
    (name: FieldName) => (e: ChangeEvent<HTMLInputElement>) =>
      props.onChange(name, e.target.value),
    [props],
  );

  const onFieldBlur = useCallback(
    (name: FieldName) => (e: FocusEvent<HTMLInputElement>) => {
      // Used only by email to drop format-error on blur. Page owns
      // the dispatch logic; this no-op is here so the JSX can attach
      // an onBlur without type-narrowing two variants. The page decides
      // whether to swap emailFormatError based on email-specific logic.
      void name;
      void e;
    },
    [],
  );

  // Stop Enter on any non-submit input from creating a stray submit
  // — the form's onSubmit already guards with formValid, so this is
  // belt-and-suspenders for accidental double-submit.
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLFormElement>) => {
      if (e.key === 'Enter' && !props.formValid) {
        e.preventDefault();
      }
    },
    [props.formValid],
  );

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
      onKeyDown={onKeyDown}
      noValidate
    >
      {props.subtitle ? (
        <p className={styles.subtitle}>
          <span>{props.subtitle.zh}</span>
          <span className={styles.subtitle__sep} aria-hidden="true">
            ·
          </span>
          <span className={styles.subtitle__en} lang="en">
            {props.subtitle.en}
          </span>
        </p>
      ) : null}

      {props.fields.map((field) => {
        const value = props.values[field.name] ?? '';
        const fieldError = props.errors[field.name];
        // Email: server field error wins over client format error.
        const errorText =
          field.name === 'email'
            ? props.errors.email || props.emailFormatError
            : fieldError;
        // Type for the input itself — password fields honour showPassword.
        const inputType =
          field.type === 'password'
            ? props.showPassword
              ? 'text'
              : 'password'
            : field.type;
        const wrapState = errorText ? 'error' : undefined;
        const inputCls = [
          styles.input,
          field.withIcon ? styles.inputWithIcon : '',
          field.withEyeToggle ? styles.inputWithToggle : '',
          errorText ? styles.inputError : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div key={field.name} className={styles.field}>
            <div className={styles.inputWrap} data-state={wrapState}>
              {field.withIcon === 'mail' ? <MailIcon /> : null}
              <input
                ref={(el) => {
                  inputsRef.current[field.name] = el;
                }}
                type={inputType}
                inputMode={field.inputMode}
                autoComplete={field.autoComplete}
                maxLength={field.maxLength}
                required
                aria-label={field.label}
                aria-invalid={errorText ? true : undefined}
                value={value}
                onChange={onFieldChange(field.name)}
                onBlur={onFieldBlur(field.name)}
                placeholder={field.placeholder}
                className={inputCls}
              />
              {field.withEyeToggle ? (
                <div className={styles.toggleWrap}>
                  <IconButton
                    variant="bare"
                    size="sm"
                    shape="circle"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      props.onToggleShowPassword();
                      // Re-focus the input on the next frame so the
                      // next keystroke lands on the input (mousedown
                      // preventDefault is the first defense; this is
                      // the second). Always set caret to end.
                      requestAnimationFrame(() => {
                        const el = inputsRef.current[field.name];
                        if (el) {
                          el.focus();
                          const end = el.value.length;
                          try {
                            el.setSelectionRange(end, end);
                          } catch {
                            /* setSelectionRange on type=password */
                          }
                        }
                      });
                    }}
                    aria-label={props.showPassword ? '隐藏密码' : '显示密码'}
                    tabIndex={-1}
                  >
                    {props.showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                </div>
              ) : null}
            </div>
            {errorText ? (
              <span className={styles.error} role="alert">
                {errorText}
              </span>
            ) : null}
          </div>
        );
      })}

      {props.mode === 'signup' && props.matchHint && props.matchHint.tone !== 'empty' && props.matchHint.zh ? (
        <span
          className={[
            styles.hint,
            props.matchHint.tone === 'match'
              ? styles.hintMatch
              : props.matchHint.tone === 'mismatch'
                ? styles.hintMismatch
                : styles.hintIncomplete,
          ].join(' ')}
          aria-live="polite"
          lang="zh"
        >
          {props.matchHint.zh}
        </span>
      ) : null}

      <div className={styles.submit}>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={props.submitting}
          disabled={!props.formValid}
        >
          {props.submitLabel}
        </Button>
      </div>

      <p className={styles.alt}>
        {props.altPrompt}
        {props.onAltClick ? (
          <button
            type="button"
            className={styles.altCta}
            onClick={props.onAltClick}
          >
            {props.altCta}
          </button>
        ) : (
          <Link href={props.altHref}>{props.altCta}</Link>
        )}
      </p>
    </form>
  );
});

export default AuthForm;
