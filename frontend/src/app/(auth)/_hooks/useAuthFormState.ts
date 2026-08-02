'use client';

/**
 * useAuthFormState — 共享 login + signup 表单状态。
 *
 * 三处使用:
 *   - /login 整页 → mode: 'login' + redirectTo = safeRedirectPath(?from=, '/')
 *   - /signup 整页 → mode: 'signup' + redirectTo 同上
 *   - AuthModal → mode 由 modal 决定 + redirectTo = window.location.pathname+search
 *
 * Hook 不做:
 *   - 不调 useRouter (调用方拿到 submit() 返回值后自己决定 router.replace 或 close)
 *   - 不调 useSearchParams (调用方解析 ?from= 后塞进 redirectTo)
 *   - 不读 window.location (modal 在外面读完传进来, 保持 hook 纯净 / 易测)
 *
 * 状态契约 (跟原 login/signup page 行为一致):
 *   - 5 个 useState 槽位: values / errors / emailFormatError / submitting / showPassword
 *   - formRef (AuthFormHandle) 父 imperative refocus
 *   - 80ms mount 自动聚焦 email, errors 变化时聚焦失败字段
 *   - 客户端校验 (email 正则 / 密码 ≥ 8 位 / 两次一致) 在 onSubmit 内做
 *   - submit() 跑 API + refresh(), 成功返回 true, 失败返回 false (AuthForm 已渲染 error)
 *   - signup 模式额外有 useMemo<MatchHint> 给 AuthForm 实时显示密码匹配提示
 *   - 5 个文案字面量 (subtitle / submitLabel / altPrompt / altCta / altHref) 在此集中,
 *     避免日后改文案走 3 处 (login page / signup page / modal)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiLogin, apiSignup, ApiError } from '../../api';
import AuthForm, {
  type AuthFormHandle,
  type AuthFormProps,
  type FieldName,
  type FieldSpec,
  type MatchHint,
} from '../_components/AuthForm';

const PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NETWORK_ERROR_RE = /failed to fetch|networkerror|load failed/i;

const FIELDS_LOGIN: readonly FieldSpec[] = [
  { name: 'email', type: 'email', label: '邮箱', withIcon: 'mail', autoComplete: 'email', inputMode: 'email' },
  { name: 'password', type: 'password', label: '密码', autoComplete: 'current-password', withEyeToggle: true, maxLength: PASSWORD_LENGTH },
];

const FIELDS_SIGNUP: readonly FieldSpec[] = [
  { name: 'email', type: 'email', label: '邮箱', withIcon: 'mail', autoComplete: 'email', inputMode: 'email' },
  { name: 'password', type: 'password', label: '密码', autoComplete: 'new-password', withEyeToggle: true, maxLength: PASSWORD_LENGTH },
  { name: 'confirm', type: 'password', label: '确认密码', autoComplete: 'new-password', maxLength: PASSWORD_LENGTH },
];

type Mode = 'login' | 'signup';
type Errors = Partial<Record<FieldName, string>>;

export interface UseAuthFormStateArgs {
  mode: Mode;
  /** 成功后落点, 调用方负责导航或关 modal。 */
  redirectTo: string;
}

export interface UseAuthFormStateResult {
  formProps: AuthFormProps;
  formRef: React.RefObject<AuthFormHandle>;
  /** 跑客户端校验 + API + refresh(), 成功 true / 失败 false。 */
  submit: () => Promise<boolean>;
}

export function useAuthFormState({ mode, redirectTo: _redirectTo }: UseAuthFormStateArgs): UseAuthFormStateResult {
  // _redirectTo is intentionally not used inside the hook — it's a hint
  // for the caller about where to land on success. The hook returns true
  // from submit() and lets the caller decide whether to router.replace
  // or close the modal.
  void _redirectTo;

  const { refresh } = useAuth();

  const [values, setValues] = useState<Record<FieldName, string>>({
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [emailFormatError, setEmailFormatError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const formRef = useRef<AuthFormHandle>(null);

  const validateEmail = useCallback((value: string): string | null => {
    if (!value) return null;
    if (!EMAIL_RE.test(value)) return '邮箱格式不正确';
    return null;
  }, []);

  // Refocus the failing field on every server-error change.
  useEffect(() => {
    if (!Object.values(errors).some(Boolean)) return;
    if (errors.email) {
      requestAnimationFrame(() => formRef.current?.focusField('email'));
    } else if (errors.password) {
      requestAnimationFrame(() => formRef.current?.focusField('password'));
    } else if (errors.confirm) {
      requestAnimationFrame(() => formRef.current?.focusField('confirm'));
    }
  }, [errors]);

  // Auto-focus the email field on mount after the card-rise + title
  // stagger settle (~80ms). Without this delay, focus races the
  // animation and the caret briefly flashes in the wrong place.
  useEffect(() => {
    const id = window.setTimeout(() => {
      formRef.current?.focusField('email');
    }, 80);
    return () => window.clearTimeout(id);
  }, []);

  const onChange = useCallback(
    (name: FieldName, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
      if (name === 'email') {
        if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
        if (emailFormatError) setEmailFormatError(validateEmail(value));
      } else if (name === 'password') {
        if (errors.password) {
          setErrors((p) => ({ ...p, password: undefined }));
        }
        // signup: clear confirm mismatch when password catches up.
        if (mode === 'signup' && errors.confirm && value === values.confirm) {
          setErrors((p) => ({ ...p, confirm: undefined }));
        }
      } else if (name === 'confirm') {
        if (mode === 'signup' && errors.confirm && value === values.password) {
          setErrors((p) => ({ ...p, confirm: undefined }));
        }
      }
    },
    [errors, emailFormatError, mode, values.confirm, values.password, validateEmail],
  );

  const onSubmit = useCallback(async (): Promise<boolean> => {
    if (submitting) return false;

    // Local validation — don't bother the server if local state is bad.
    const localEmailError = validateEmail(values.email);
    if (localEmailError) {
      setEmailFormatError(localEmailError);
      setErrors((p) => ({ ...p, email: undefined }));
      requestAnimationFrame(() => formRef.current?.focusField('email'));
      return false;
    }
    if (values.password.length < PASSWORD_LENGTH) {
      setErrors((p) => ({ ...p, password: `密码至少 ${PASSWORD_LENGTH} 个字符` }));
      requestAnimationFrame(() => formRef.current?.focusField('password'));
      return false;
    }
    if (mode === 'signup' && values.confirm !== values.password) {
      setErrors((p) => ({ ...p, confirm: '两次输入的密码不一致' }));
      requestAnimationFrame(() => formRef.current?.focusField('confirm'));
      return false;
    }

    setErrors({});
    setEmailFormatError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await apiLogin({ email: values.email.trim(), password: values.password });
      } else {
        await apiSignup({ email: values.email.trim(), password: values.password });
      }
      await refresh();
      return true;
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.fieldErrors) {
        setErrors(apiErr.fieldErrors as Errors);
      } else {
        const msg = apiErr.message ?? '';
        const isNetworkError = NETWORK_ERROR_RE.test(msg);
        if (mode === 'login') {
          // Mirror login page's network fallback behaviour: pin the
          // message on the email slot (or any slot — email is the
          // safest default since it's the only one we don't otherwise
          // touch here).
          setErrors({
            email: isNetworkError || !msg ? '网络异常,请稍后重试' : msg,
          });
        } else {
          // signup: 409 "该邮箱已注册" has no field_errors envelope.
          // Surface on the email slot — it IS an email problem even
          // though the backend didn't tag it.
          setErrors({ email: apiErr.message ?? '注册失败' });
        }
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [submitting, values, mode, validateEmail, refresh]);

  const onToggleShowPassword = useCallback(() => {
    setShowPassword((v) => !v);
  }, []);

  // Live match hint — signup only. Memo'd so the .hint class doesn't
  // churn on unrelated renders.
  const matchHint = useMemo<MatchHint | undefined>(() => {
    if (mode !== 'signup') return undefined;
    const { password, confirm } = values;
    if (password.length === 0 && confirm.length === 0) {
      return { tone: 'empty', zh: '' };
    }
    if (password.length >= PASSWORD_LENGTH && confirm.length >= PASSWORD_LENGTH) {
      if (password === confirm) {
        return { tone: 'match', zh: '一致' };
      }
      return { tone: 'mismatch', zh: '两次输入不一致' };
    }
    return { tone: 'incomplete', zh: '密码需要 8 位' };
  }, [mode, values.password, values.confirm]);

  const emailValid = values.email.length > 0 && emailFormatError === null;
  const passwordValid = values.password.length >= PASSWORD_LENGTH;
  const confirmValid =
    mode === 'signup' &&
    values.confirm.length >= PASSWORD_LENGTH &&
    values.confirm === values.password;
  const formValid =
    emailValid && passwordValid && !submitting && (mode === 'login' || confirmValid);

  // Stable copy per mode — centralise here so login / signup pages and
  // the modal all render the same text.
  const subtitle =
    mode === 'login'
      ? { zh: '登录已有账号', en: 'Welcome back' }
      : { zh: '创建新账号', en: 'Create your account' };
  const submitLabel = mode === 'login' ? '登录' : '注册';
  const altPrompt = mode === 'login' ? '还没有账号？' : '已有账号？';
  const altCta = mode === 'login' ? '注册' : '登录';

  const formProps: AuthFormProps = {
    mode,
    subtitle,
    fields: mode === 'login' ? FIELDS_LOGIN : FIELDS_SIGNUP,
    values,
    errors,
    emailFormatError,
    formValid,
    submitting,
    showPassword,
    submitLabel,
    altPrompt,
    altCta,
    // Caller is responsible for routing (login/signup pages: router.replace;
    // AuthModal: close() + optional router.replace). altHref is only used
    // when the caller DOESN'T pass onAltClick — i.e. the deep-link path.
    // modal passes onAltClick so altHref is unused; we still need to
    // satisfy the prop type with a sane value.
    altHref: mode === 'login' ? '/signup' : '/login',
    onChange,
    onSubmit,
    onToggleShowPassword,
    ...(matchHint ? { matchHint } : {}),
  };

  return { formProps, formRef, submit: onSubmit };
}
