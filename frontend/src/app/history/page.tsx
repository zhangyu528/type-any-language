'use client';

/**
 * /history — auth-gated page. v1 placeholder.
 *
 * The deliverable for v1 is the gate itself: prove that the cookie
 * + get_current_user dependency + protected route works end-to-end.
 * Real history data (practice_attempts table, time-series charts)
 * lands in a later PR.
 *
 * Redirect-on-no-auth is client-side via useEffect + router.replace.
 * Why not middleware.ts: Edge Runtime JWT verification would need the
 * `jose` library and adds complexity not justified by a single
 * protected route. Future hardening: add middleware.ts.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main className="history-shell">
        <p className="history-loading">载入中…</p>
        <style dangerouslySetInnerHTML={{ __html: `
          .history-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .history-loading { color: var(--label-tertiary); font-size: var(--type-body); }
        ` }} />
      </main>
    );
  }

  return (
    <main className="history">
      <header className="history__header">
        <h1>我的历史</h1>
        <p className="history__user">
          登录身份：{user.display_name} <span className="history__email">({user.email})</span>
        </p>
      </header>

      <section className="history__placeholder">
        <p>还没有练习记录</p>
        <Link href="/" className="history__cta">开始练习</Link>
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .history {
          max-width: 720px;
          margin: 0 auto;
          padding: var(--space-7) var(--space-5);
        }
        .history__header {
          padding-bottom: var(--space-5);
          border-bottom: 1px solid var(--separator);
        }
        .history__header h1 {
          font-size: var(--type-title-1);
          font-weight: var(--type-title-1-weight);
          line-height: var(--type-title-1-lh);
          color: var(--label-primary);
          margin-bottom: var(--space-2);
        }
        .history__user {
          font-size: var(--type-body);
          color: var(--label-secondary);
        }
        .history__email {
          color: var(--label-tertiary);
          font-size: var(--type-caption);
          margin-left: var(--space-2);
        }
        .history__placeholder {
          padding: var(--space-9) 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
        }
        .history__placeholder p {
          font-size: var(--type-body);
          color: var(--label-tertiary);
        }
        .history__cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 40px;
          padding: 0 var(--space-5);
          background: var(--label-primary);
          color: var(--surface);
          text-decoration: none;
          font-size: var(--type-body);
          font-weight: var(--type-body-emphasis-weight);
          border-radius: var(--radius-md);
        }
      ` }} />
    </main>
  );
}