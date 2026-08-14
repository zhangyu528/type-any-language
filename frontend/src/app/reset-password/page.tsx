'use client';

/**
 * /reset-password — 用邮件链接里的 token 设置新密码。
 *
 * 与登录弹窗里的"忘记密码？"子流程不同:这里是邮件链接打开的独立全屏页
 * (链接在浏览器里打开,无法走 modal)。读取 ?token=&email=,先预检链接有效性,
 * 再让用户设新密码。成功/失效各有独立状态。
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CurvedInput from '@/components/CurvedInput';
import { apiValidateResetToken, apiResetPassword, ApiError } from '@/app/api';
import styles from './reset-password.module.css';

// 本地锁 icon(CurvedInput 的 icon 需自绘 SVG 节点)。
const IconLock = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <div className={styles.card}>
            <p className={styles.subtitle}>加载中…</p>
          </div>
        </main>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const email = searchParams.get('email') ?? '';

  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !email) {
        if (!cancelled) setStatus('invalid');
        return;
      }
      const res = await apiValidateResetToken({ token, email });
      if (cancelled) return;
      setStatus(res.valid ? 'valid' : 'invalid');
    })();
    return () => {
      cancelled = true;
    };
  }, [token, email]);

  const handleSubmit = useCallback(async () => {
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiResetPassword({ email, token, password });
      setStatus('done');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 400) {
          setStatus('invalid');
          setError('重置链接无效或已过期，请重新申请');
        } else {
          setError(e.message || '重置失败，请重试');
        }
      } else {
        setError('网络不太通，稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }, [email, token, password]);

  const goLogin = useCallback(() => {
    router.push('/login');
  }, [router]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {status === 'checking' && (
          <div className={styles.inner}>
            <h1 className={styles.title}>验证链接中…</h1>
            <p className={styles.subtitle}>请稍候</p>
          </div>
        )}

        {status === 'invalid' && (
          <div className={styles.inner}>
            <h1 className={styles.title}>链接无效或已过期</h1>
            <p className={styles.subtitle}>
              重置链接可能已被使用，或超过 30 分钟有效期。
            </p>
            <button type="button" className={styles.primaryBtn} onClick={goLogin}>
              返回登录
            </button>
          </div>
        )}

        {status === 'valid' && (
          <div className={styles.inner}>
            <h1 className={styles.title}>设置新密码</h1>
            <p className={styles.subtitle}>为 {email} 设置一个新密码（至少 8 位）。</p>
            <div className={styles.stage}>
              <CurvedInput
                value={password}
                onChange={setPassword}
                onSubmit={handleSubmit}
                placeholder="至少 8 位字符"
                label="新密码"
                buttonText={loading ? '处理中...' : '设置新密码'}
                type="password"
                name="new-password"
                icon={IconLock}
                showEye
                bend={0}
                width="100%"
                height={68}
                fontSize={17}
                cornerRadius={20}
                borderWidth={1.5}
                shadowSize="lg"
                theme="light"
                showButton
                showIcon
                buttonColor="#2F80C0"
                autoFocus
                disabled={loading}
                loading={loading}
              />
              {error ? <p className={styles.error}>{error}</p> : null}
            </div>
          </div>
        )}

        {status === 'done' && (
          <div className={styles.inner}>
            <h1 className={styles.title}>密码已重置</h1>
            <p className={styles.subtitle}>现在可以用新密码登录了。</p>
            <button type="button" className={styles.primaryBtn} onClick={goLogin}>
              去登录
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
